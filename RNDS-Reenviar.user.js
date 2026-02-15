// ==UserScript==
// @name         SPRNDS - Reenviar v13.3.4
// @namespace    http://tampermonkey.net/
// @version      13.3.4
// @description  Ajuste dinâmico corrigido + Controles em tempo real
// @author       Renato Krebs Rosa
// @match        *://*/rnds/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @supportURL   https://github.com/RenatoKR/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // ⚙️ CONFIGURAÇÕES PADRÃO
    // ============================================
    const CONFIG = {
        concorrenciaInicial: 15,
        concorrenciaMaxima: 50,
        concorrenciaMinima: 5,
        registrosPorPagina: 15,
        pausaEntreLotes: 200,
        timeoutRequisicao: 30000,
        maxRetentativas: 2,
        ajusteAutomatico: true,
        limiteMaximoPaginas: 100,
        buscarTodasPaginas: true,
        habilitarCheckpoint: true,
        salvarCheckpointACada: 10,
        habilitarFiltroData: false,
        dataInicio: '2020-01-01',
        dataFim: '2026-02-14'
    };

    // ============================================
    // 💾 GERENCIADOR DE CHECKPOINT PERMANENTE
    // ============================================

    class CheckpointManager {
        constructor() {
            this.STORAGE_KEY = 'RNDS_CHECKPOINT';
            this.checkpoint = this.carregar() || this.criar();
        }

        criar() {
            console.log('💾 Criando novo checkpoint vazio');
            return {
                timestamp: Date.now(),
                idsSucesso: [],
                estatisticas: {
                    totalSucesso: 0,
                    totalErro: 0,
                    totalTimeout: 0,
                    totalRetentativas: 0
                },
                versao: '13.3.4',
                execucoes: []
            };
        }

        carregar() {
            try {
                const dados = localStorage.getItem(this.STORAGE_KEY);
                if (dados) {
                    const checkpoint = JSON.parse(dados);
                    console.log('💾 Checkpoint carregado:');
                    console.log(`   • Data: ${new Date(checkpoint.timestamp).toLocaleString()}`);
                    console.log(`   • IDs com SUCESSO: ${checkpoint.idsSucesso.length}`);
                    console.log(`   • Execuções anteriores: ${checkpoint.execucoes?.length || 0}`);
                    return checkpoint;
                }
            } catch (e) {
                console.warn('⚠️ Erro ao carregar checkpoint:', e);
            }
            return null;
        }

        iniciarExecucao() {
            const execucaoAtual = {
                timestamp: Date.now(),
                idsSucesso: [],
                estatisticas: {
                    totalSucesso: 0,
                    totalErro: 0,
                    totalTimeout: 0,
                    totalRetentativas: 0
                }
            };

            this.checkpoint.execucoes = this.checkpoint.execucoes || [];
            this.checkpoint.execucoes.push(execucaoAtual);
            this.execucaoAtual = execucaoAtual;

            console.log('💾 Nova execução iniciada');
            console.log(`   • IDs já com sucesso (permanentes): ${this.checkpoint.idsSucesso.length}`);
            this.salvar();
        }

        registrarProcessado(id, resultado) {
            if (!this.checkpoint || !this.execucaoAtual) return;

            if (resultado.status === 'SUCESSO') {
                if (!this.checkpoint.idsSucesso.includes(id)) {
                    this.checkpoint.idsSucesso.push(id);
                    this.checkpoint.estatisticas.totalSucesso++;
                }

                if (!this.execucaoAtual.idsSucesso.includes(id)) {
                    this.execucaoAtual.idsSucesso.push(id);
                    this.execucaoAtual.estatisticas.totalSucesso++;
                }

                if (this.checkpoint.idsSucesso.length % CONFIG.salvarCheckpointACada === 0) {
                    this.salvar();
                }

            } else if (resultado.status === 'TIMEOUT') {
                this.execucaoAtual.estatisticas.totalTimeout++;
                this.checkpoint.estatisticas.totalTimeout++;
            } else {
                this.execucaoAtual.estatisticas.totalErro++;
                this.checkpoint.estatisticas.totalErro++;
            }

            if (resultado.tentativa > 1) {
                this.execucaoAtual.estatisticas.totalRetentativas++;
                this.checkpoint.estatisticas.totalRetentativas++;
            }
        }

        salvar() {
            if (!this.checkpoint) return;

            try {
                this.checkpoint.timestamp = Date.now();
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.checkpoint));
                console.log(`💾 Checkpoint salvo: ${this.checkpoint.idsSucesso.length} IDs permanentes com sucesso`);
            } catch (e) {
                console.error('❌ Erro ao salvar checkpoint:', e);
            }
        }

        jaTemSucesso(id) {
            return this.checkpoint && this.checkpoint.idsSucesso.includes(id);
        }

        limpar() {
            if (confirm(
                '⚠️ ATENÇÃO: LIMPAR CHECKPOINT PERMANENTE\\n\\n' +
                `Você tem ${this.checkpoint.idsSucesso.length} IDs com sucesso salvos.\\n\\n` +
                'Ao limpar, TODOS os sucessos anteriores serão perdidos!\\n' +
                'Todos os registros serão processados novamente do zero.\\n\\n' +
                'Tem certeza que deseja LIMPAR?'
            )) {
                localStorage.removeItem(this.STORAGE_KEY);
                this.checkpoint = this.criar();
                console.log('🗑️ Checkpoint limpo - todos os IDs serão reprocessados');
                alert('✅ Checkpoint limpo com sucesso!\\n\\nNa próxima execução, todos os registros serão processados.');
            }
        }

        getResumo() {
            if (!this.checkpoint) return null;

            return {
                dataCheckpoint: new Date(this.checkpoint.timestamp),
                idsSucesso: this.checkpoint.idsSucesso.length,
                estatisticas: this.checkpoint.estatisticas,
                totalExecucoes: this.checkpoint.execucoes?.length || 0
            };
        }

        getHistorico() {
            if (!this.checkpoint || !this.checkpoint.execucoes) return [];

            return this.checkpoint.execucoes.map((exec, idx) => ({
                numero: idx + 1,
                data: new Date(exec.timestamp).toLocaleString(),
                sucessos: exec.idsSucesso.length,
                erros: exec.estatisticas.totalErro,
                timeouts: exec.estatisticas.totalTimeout
            }));
        }
    }

    const checkpointManager = new CheckpointManager();

    // ============================================
    // 📊 ESTADO GLOBAL
    // ============================================
    let estado = {
        processando: false,
        pausado: false,
        cancelado: false,
        iniciado: null,
        concorrenciaAtual: CONFIG.concorrenciaInicial,
        totalBuscados: 0,
        totalProcessados: 0,
        totalPulados: 0,
        totalSucesso: 0,
        totalErro: 0,
        totalTimeout: 0,
        totalRetentativas: 0,
        paginaAtual: 0,
        totalPaginas: 0,
        tempoMedioPorLote: 0,
        ultimosTempos: [],
        registros: [],
        resultados: []
    };

    let TOKEN_GLOBAL = null;

    // ============================================
    // 🔑 CAPTURA DE TOKEN
    // ============================================

    function interceptarXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            this._method = method;
            this._requestHeaders = {};
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
            this._requestHeaders[header] = value;

            if (header.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
                TOKEN_GLOBAL = value.replace('Bearer ', '');
                localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
                atualizarBotaoToken(true);
            }

            return originalSetRequestHeader.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function() {
            this.addEventListener('load', function() {
                if (this._requestHeaders && this._requestHeaders['Authorization']) {
                    const auth = this._requestHeaders['Authorization'];
                    if (auth.startsWith('Bearer ') && !TOKEN_GLOBAL) {
                        TOKEN_GLOBAL = auth.replace('Bearer ', '');
                        localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
                        atualizarBotaoToken(true);
                    }
                }
            });

            return originalSend.apply(this, arguments);
        };

        console.log('✅ Interceptor XHR instalado');
    }

    function interceptarFetch() {
        const originalFetch = window.fetch;

        window.fetch = async function(...args) {
            const [url, options] = args;

            if (options?.headers) {
                const headers = options.headers;

                if (headers.Authorization && headers.Authorization.startsWith('Bearer ')) {
                    TOKEN_GLOBAL = headers.Authorization.replace('Bearer ', '');
                    localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
                    atualizarBotaoToken(true);
                }
            }

            return await originalFetch.apply(this, args);
        };

        console.log('✅ Interceptor Fetch instalado');
    }

    function tentarLocalStorage() {
        const possiveisChaves = ['RNDS_TOKEN', 'auth_token', 'token', 'authorization', 'bearer_token', 'access_token'];

        for (const chave of possiveisChaves) {
            const valor = localStorage.getItem(chave) || sessionStorage.getItem(chave);
            if (valor && valor.length > 20) {
                TOKEN_GLOBAL = valor;
                console.log(`🔑 Token encontrado em storage: ${chave}`);
                atualizarBotaoToken(true);
                return true;
            }
        }

        return false;
    }

    function solicitarTokenManual() {
        const token = prompt(
            '🔑 TOKEN NÃO DETECTADO\\n\\n' +
            'Passos:\\n' +
            '1. F12 → Network\\n' +
            '2. Faça uma pesquisa\\n' +
            '3. Clique em "/api/vaccine-sync"\\n' +
            '4. Copie o header "Authorization"\\n\\n' +
            'Token:'
        );

        if (token) {
            TOKEN_GLOBAL = token.replace('Bearer ', '').trim();
            localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
            console.log('🔑 Token fornecido manualmente!');
            atualizarBotaoToken(true);
            return true;
        }

        return false;
    }

    function capturarToken() {
        console.log('🎯 Iniciando captura de token...');
        interceptarXHR();
        interceptarFetch();

        if (tentarLocalStorage()) {
            return;
        }

        console.log('💡 Aguardando requisições...');
    }

    function atualizarBotaoToken(capturado) {
        const botaoToken = document.getElementById('btnVerToken');
        if (botaoToken) {
            const icon = botaoToken.querySelector('span.icon-emoji');
            if (icon) {
                icon.style.color = capturado ? '#4caf50' : '#ff9800';
                botaoToken.title = capturado ? 'Token capturado!' : 'Token não capturado';
            }
        }
    }

    // ============================================
    // 🌐 API - PAGINAÇÃO COM FILTRO DE DATA
    // ============================================

    async function buscarVacinasComErro(page = 0, limit = 15) {
        let url = `/rnds/api/vaccine-sync?sort=false:desc&page=${page}&limit=${limit}&sendStatus=ERROR`;

        if (CONFIG.habilitarFiltroData) {
            url += `&between=vaccineDate,${CONFIG.dataInicio},${CONFIG.dataFim}`;
        }

        console.log(`🔍 Buscando página ${page}...`);
        if (CONFIG.habilitarFiltroData) {
            console.log(`   📅 Período: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`);
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Encoding': 'gzip, deflate, br, zstd',
                    'Authorization': `Bearer ${TOKEN_GLOBAL}`,
                    'Cache-Control': 'no-cache',
                    'accept-language': 'pt-BR',
                    'DNT': '1',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const dados = await response.json();

            let registros = [];
            let totalElementos = 0;
            let totalPaginas = 0;

            if (dados.content && Array.isArray(dados.content)) {
                registros = dados.content;
                totalElementos = dados.totalElements || 0;
                totalPaginas = dados.totalPages || 0;
            } else if (dados.data && Array.isArray(dados.data)) {
                registros = dados.data;
                totalElementos = dados.total || dados.totalElements || 0;
                totalPaginas = dados.totalPages || 0;
            } else if (Array.isArray(dados)) {
                registros = dados;
                totalElementos = 0;
                totalPaginas = 0;
            }

            console.log(`   ✅ ${registros.length} registros retornados`);
            if (totalElementos > 0) {
                console.log(`   📊 Total na base: ${totalElementos} registros`);
            }
            if (totalPaginas > 0) {
                console.log(`   📄 Total de páginas: ${totalPaginas}`);
            }

            return {
                content: registros,
                totalElements: totalElementos,
                totalPages: totalPaginas,
                currentPage: page
            };

        } catch (erro) {
            console.error(`❌ Erro ao buscar página ${page}:`, erro);
            return {
                content: [],
                totalElements: 0,
                totalPages: 0,
                currentPage: page
            };
        }
    }

    async function buscarTodasPaginas() {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📄 INICIANDO BUSCA PAGINADA');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📌 Estratégia: Replicar comportamento da aplicação web');
        console.log(`📌 Limite por página: ${CONFIG.registrosPorPagina} registros`);

        if (CONFIG.habilitarFiltroData) {
            console.log(`📅 Filtro de período: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`);
        } else {
            console.log('📅 Sem filtro de período (buscando todos)');
        }

        console.log('');

        let page = 0;
        let todosRegistros = [];
        let totalElementosNaBase = 0;
        let totalPaginasNaBase = 0;

        while (page < CONFIG.limiteMaximoPaginas) {
            if (estado.cancelado) {
                console.log('⚠️ Busca cancelada pelo usuário');
                break;
            }

            estado.paginaAtual = page + 1;

            atualizarModal(
                `Buscando página ${page + 1}${totalPaginasNaBase > 0 ? `/${totalPaginasNaBase}` : ''}...`
            );

            const dados = await buscarVacinasComErro(page, CONFIG.registrosPorPagina);

            if (dados.totalElements > 0 && dados.totalElements !== totalElementosNaBase) {
                totalElementosNaBase = dados.totalElements;
                console.log(`📊 API reporta: ${totalElementosNaBase} registros no total`);
            }

            if (dados.totalPages > 0 && dados.totalPages !== totalPaginasNaBase) {
                totalPaginasNaBase = dados.totalPages;
                estado.totalPaginas = totalPaginasNaBase;
                console.log(`📄 API reporta: ${totalPaginasNaBase} páginas no total`);
            }

            if (!dados.content || dados.content.length === 0) {
                console.log('');
                console.log('✅ FIM: Página vazia (sem registros)');
                break;
            }

            const qtdNaPagina = dados.content.length;
            todosRegistros.push(...dados.content);
            estado.totalBuscados = todosRegistros.length;

            console.log(`   💾 Acumulado: ${todosRegistros.length} registros`);

            if (qtdNaPagina < CONFIG.registrosPorPagina) {
                console.log('');
                console.log(`✅ FIM: Última página detectada (${qtdNaPagina} < ${CONFIG.registrosPorPagina})`);
                break;
            }

            if (totalPaginasNaBase > 0 && (page + 1) >= totalPaginasNaBase) {
                console.log('');
                console.log(`✅ FIM: Todas as ${totalPaginasNaBase} páginas foram processadas`);
                break;
            }

            if (totalElementosNaBase > 0 && todosRegistros.length >= totalElementosNaBase) {
                console.log('');
                console.log(`✅ FIM: Todos os ${totalElementosNaBase} registros foram buscados`);
                break;
            }

            page++;
            await new Promise(r => setTimeout(r, 100));
        }

        if (page >= CONFIG.limiteMaximoPaginas) {
            console.warn('');
            console.warn(`⚠️ ATENÇÃO: Limite de segurança atingido (${CONFIG.limiteMaximoPaginas} páginas)`);
            if (totalElementosNaBase > 0) {
                console.warn(`⚠️ Existem ${totalElementosNaBase} registros mas buscamos apenas ${todosRegistros.length}`);
                console.warn(`⚠️ Aumente CONFIG.limiteMaximoPaginas se necessário`);
            }
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 BUSCA FINALIZADA');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`✅ Registros obtidos: ${todosRegistros.length}`);
        console.log(`📄 Páginas processadas: ${page}`);
        if (totalElementosNaBase > 0) {
            console.log(`📊 Total na base (reportado pela API): ${totalElementosNaBase}`);
        }
        if (CONFIG.habilitarFiltroData) {
            console.log(`📅 Período filtrado: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`);
        }
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        return todosRegistros;
    }

    async function reenviarVacina(registro, tentativa = 1) {
        const url = '/rnds/api/vaccine-sync/send-register';

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeoutRequisicao);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${TOKEN_GLOBAL}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/plain, */*',
                    'accept-language': 'pt-BR'
                },
                body: JSON.stringify({ id: registro.id }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const resultado = {
                id: registro.id,
                cpf: registro.pacientCpf || registro.patientCpf || 'N/A',
                vacina: registro.vaccineDescription || registro.vaccine || 'N/A',
                status: response.ok ? 'SUCESSO' : 'ERRO',
                statusCode: response.status,
                tentativa: tentativa,
                timestamp: new Date().toISOString()
            };

            if (response.ok) {
                estado.totalSucesso++;
                if (CONFIG.habilitarCheckpoint) {
                    checkpointManager.registrarProcessado(registro.id, resultado);
                }
            } else {
                if (tentativa < CONFIG.maxRetentativas) {
                    estado.totalRetentativas++;
                    await new Promise(r => setTimeout(r, 1000));
                    return await reenviarVacina(registro, tentativa + 1);
                }
                estado.totalErro++;
                resultado.erro = await response.text();
                if (CONFIG.habilitarCheckpoint) {
                    checkpointManager.registrarProcessado(registro.id, resultado);
                }
            }

            return resultado;

        } catch (erro) {
            const isTimeout = erro.name === 'AbortError';

            if (tentativa < CONFIG.maxRetentativas && !isTimeout) {
                estado.totalRetentativas++;
                await new Promise(r => setTimeout(r, 1000));
                return await reenviarVacina(registro, tentativa + 1);
            }

            if (isTimeout) {
                estado.totalTimeout++;
            } else {
                estado.totalErro++;
            }

            const resultado = {
                id: registro.id,
                cpf: registro.pacientCpf || registro.patientCpf || 'N/A',
                vacina: registro.vaccineDescription || registro.vaccine || 'N/A',
                status: isTimeout ? 'TIMEOUT' : 'ERRO',
                statusCode: 0,
                erro: erro.message,
                tentativa: tentativa,
                timestamp: new Date().toISOString()
            };

            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.registrarProcessado(registro.id, resultado);
            }

            return resultado;
        }
    }

    // ✨ CORRIGIDO: Ajuste dinâmico durante o processamento
    async function processarLote(registros) {
        const inicio = Date.now();
        const resultados = [];

        for (let i = 0; i < registros.length; i += estado.concorrenciaAtual) {
            while (estado.pausado && !estado.cancelado) {
                await new Promise(r => setTimeout(r, 500));
            }

            if (estado.cancelado) {
                console.log('⚠️ Processamento cancelado pelo usuário');
                break;
            }

            // Usa concorrência atual (pode ter mudado!)
            const lote = registros.slice(i, i + estado.concorrenciaAtual);

            const loteFiltrado = lote.filter(r => {
                if (CONFIG.habilitarCheckpoint && checkpointManager.jaTemSucesso(r.id)) {
                    estado.totalPulados++;
                    console.log(`⏭️ ID ${r.id} já teve SUCESSO em execução anterior - pulando`);
                    return false;
                }
                return true;
            });

            if (loteFiltrado.length === 0) {
                console.log(`⏭️ Lote inteiro já teve sucesso anteriormente - continuando...`);
                continue;
            }

            const promises = loteFiltrado.map(r => reenviarVacina(r));
            const resultadosLote = await Promise.allSettled(promises);

            // Coleta resultados do lote
            const resultadosLoteValidos = [];
            resultadosLote.forEach(r => {
                if (r.status === 'fulfilled') {
                    resultados.push(r.value);
                    resultadosLoteValidos.push(r.value);
                    estado.totalProcessados++;
                }
            });

            atualizarModal();

            // ✨ AJUSTE AUTOMÁTICO APÓS CADA LOTE (não no final!)
            if (CONFIG.ajusteAutomatico && resultadosLoteValidos.length > 0) {
                ajustarConcorrencia(resultadosLoteValidos);
            }

            if (i + estado.concorrenciaAtual < registros.length) {
                await new Promise(r => setTimeout(r, CONFIG.pausaEntreLotes));
            }
        }

        if (CONFIG.habilitarCheckpoint) {
            checkpointManager.salvar();
        }

        const tempoLote = Date.now() - inicio;
        estado.ultimosTempos.push(tempoLote);
        if (estado.ultimosTempos.length > 10) estado.ultimosTempos.shift();
        estado.tempoMedioPorLote = estado.ultimosTempos.reduce((a,b) => a+b, 0) / estado.ultimosTempos.length;

        return resultados;
    }

    // ✨ CORRIGIDO: Calcula taxa apenas do lote atual
    function ajustarConcorrencia(resultadosLote) {
        const taxaSucesso = resultadosLote.filter(r => r.status === 'SUCESSO').length / resultadosLote.length;

        const concorrenciaAnterior = estado.concorrenciaAtual;

        if (taxaSucesso > 0.95 && estado.concorrenciaAtual < CONFIG.concorrenciaMaxima) {
            estado.concorrenciaAtual = Math.min(
                estado.concorrenciaAtual + 5,
                CONFIG.concorrenciaMaxima
            );
            console.log(`⚡ Concorrência aumentada: ${concorrenciaAnterior} → ${estado.concorrenciaAtual} (taxa: ${(taxaSucesso*100).toFixed(1)}%)`);
        } else if (taxaSucesso < 0.80 && estado.concorrenciaAtual > CONFIG.concorrenciaMinima) {
            estado.concorrenciaAtual = Math.max(
                estado.concorrenciaAtual - 5,
                CONFIG.concorrenciaMinima
            );
            console.log(`⚠️ Concorrência reduzida: ${concorrenciaAnterior} → ${estado.concorrenciaAtual} (taxa: ${(taxaSucesso*100).toFixed(1)}%)`);
        }

        // Atualiza no modal
        atualizarModal();
    }

    // ============================================
    // 🎮 CONTROLE
    // ============================================

    function pausarProcessamento() {
        estado.pausado = true;
        console.log('⏸️ Processamento pausado');
        if (CONFIG.habilitarCheckpoint) {
            checkpointManager.salvar();
        }
        atualizarBotoesDuranteExecucao();
    }

    function continuarProcessamento() {
        estado.pausado = false;
        console.log('▶️ Processamento retomado');
        atualizarBotoesDuranteExecucao();
    }

    function cancelarProcessamento() {
        if (confirm(
            '⚠️ Confirma cancelar o processamento?\\n\\n' +
            'Os registros já enviados com sucesso não serão revertidos.\\n' +
            'O checkpoint PERMANENTE será mantido.\\n' +
            'Você pode continuar em outra execução.\\n\\n' +
            'Cancelar?'
        )) {
            estado.cancelado = true;
            estado.pausado = false;
            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.salvar();
            }
            console.log('🛑 Processamento cancelado');
            console.log(`💾 Checkpoint mantém ${checkpointManager.checkpoint.idsSucesso.length} IDs com sucesso`);
        }
    }

    // ✨ NOVO: Ajustar workers em tempo real
    window.ajustarWorkers = function(delta) {
        const novo = estado.concorrenciaAtual + delta;
        if (novo < CONFIG.concorrenciaMinima) {
            alert(`⚠️ Mínimo: ${CONFIG.concorrenciaMinima} workers`);
            return;
        }
        if (novo > CONFIG.concorrenciaMaxima) {
            alert(`⚠️ Máximo: ${CONFIG.concorrenciaMaxima} workers`);
            return;
        }
        estado.concorrenciaAtual = novo;
        console.log(`⚡ Workers ajustado manualmente: ${novo}`);
        atualizarModal();
    };

    window.aplicarLimitesWorkers = function() {
        const minInput = document.getElementById('workersMin');
        const maxInput = document.getElementById('workersMax');

        const min = parseInt(minInput.value);
        const max = parseInt(maxInput.value);

        if (min < 1 || max < 1) {
            alert('⚠️ Valores devem ser maiores que 0');
            return;
        }

        if (min > max) {
            alert('⚠️ Mínimo não pode ser maior que máximo');
            return;
        }

        CONFIG.concorrenciaMinima = min;
        CONFIG.concorrenciaMaxima = max;

        // Ajusta atual se estiver fora dos limites
        if (estado.concorrenciaAtual < min) {
            estado.concorrenciaAtual = min;
        }
        if (estado.concorrenciaAtual > max) {
            estado.concorrenciaAtual = max;
        }

        console.log(`⚙️ Limites atualizados: ${min} - ${max}`);
        console.log(`⚡ Workers atual: ${estado.concorrenciaAtual}`);

        alert(`✅ Limites aplicados!\\n\\nMín: ${min}\\nMáx: ${max}\\nAtual: ${estado.concorrenciaAtual}`);
        atualizarModal();
    };

    async function iniciarReenvioAPI() {
        if (estado.processando) {
            alert('⚠️ Já existe um processamento em andamento!');
            return;
        }

        if (!TOKEN_GLOBAL) {
            const tentarManual = confirm(
                '⚠️ TOKEN NÃO DETECTADO\\n\\n' +
                'Deseja fornecê-lo manualmente?'
            );

            if (tentarManual) {
                if (!solicitarTokenManual()) {
                    alert('❌ Token necessário!');
                    return;
                }
            } else {
                alert('❌ Token necessário!\\n\\nDica: Faça uma pesquisa no sistema.');
                return;
            }
        }

        const resumo = checkpointManager.getResumo();
        let mensagemInicial = '🚀 Iniciar reenvio via API?\\n\\n';

        if (resumo && resumo.idsSucesso > 0) {
            mensagemInicial +=
                `💾 CHECKPOINT ATIVO:\\n` +
                `   • ${resumo.idsSucesso} IDs já tiveram SUCESSO\\n` +
                `   • Esses IDs serão PULADOS automaticamente\\n` +
                `   • Apenas registros sem sucesso serão processados\\n\\n`;
        }

        mensagemInicial +=
            `⚙️ CONFIGURAÇÕES:\\n` +
            `   • Paginação: ${CONFIG.registrosPorPagina} registros/página\\n` +
            `   • Concorrência: ${CONFIG.concorrenciaInicial} → ${CONFIG.concorrenciaMaxima}\\n` +
            `   • Retry: ${CONFIG.maxRetentativas}x\\n` +
            `   • Checkpoint: ${CONFIG.habilitarCheckpoint ? 'ATIVO (permanente)' : 'DESATIVADO'}\\n`;

        if (CONFIG.habilitarFiltroData) {
            mensagemInicial +=
                `   • Filtro de Período: ${CONFIG.dataInicio} até ${CONFIG.dataFim}\\n`;
        } else {
            mensagemInicial += `   • Filtro de Período: DESATIVADO (todos)\\n`;
        }
        mensagemInicial += '\\n';

        if (resumo && resumo.totalExecucoes > 0) {
            mensagemInicial += `📊 Execuções anteriores: ${resumo.totalExecucoes}\\n\\n`;
        }

        mensagemInicial += 'Continuar?';

        if (!confirm(mensagemInicial)) {
            return;
        }

        estado = {
            processando: true,
            pausado: false,
            cancelado: false,
            iniciado: Date.now(),
            concorrenciaAtual: CONFIG.concorrenciaInicial,
            totalBuscados: 0,
            totalProcessados: 0,
            totalPulados: 0,
            totalSucesso: 0,
            totalErro: 0,
            totalTimeout: 0,
            totalRetentativas: 0,
            paginaAtual: 0,
            totalPaginas: 0,
            tempoMedioPorLote: 0,
            ultimosTempos: [],
            registros: [],
            resultados: []
        };

        criarModal();
        console.log('🚀 Iniciando reenvio via API Direct v13.3.4...');
        console.log(`💾 Checkpoint permanente: ${resumo ? resumo.idsSucesso : 0} IDs com sucesso`);
        if (CONFIG.habilitarFiltroData) {
            console.log(`📅 Período: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`);
        }

        try {
            atualizarModal('Buscando registros...');

            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.iniciarExecucao();
            }

            estado.registros = await buscarTodasPaginas();
            estado.totalBuscados = estado.registros.length;

            if (estado.cancelado) {
                fecharModal();
                estado.processando = false;
                return;
            }

            if (estado.totalBuscados === 0) {
                let msg = '⚠️ Não há registros com erro para processar!';
                if (CONFIG.habilitarFiltroData) {
                    msg += `\\n\\nPeríodo configurado: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`;
                    msg += '\\n\\nDica: Verifique se há registros neste período ou ajuste as datas nas Configurações.';
                }
                alert(msg);
                fecharModal();
                estado.processando = false;
                return;
            }

            console.log(`📊 Total: ${estado.totalBuscados} registros em ${estado.paginaAtual} página(s)`);

            if (resumo && resumo.idsSucesso > 0) {
                console.log(`💾 ${resumo.idsSucesso} IDs serão pulados (já tiveram sucesso)`);
            }

            atualizarModal('Processando reenvios...');

            const resultados = await processarLote(estado.registros);
            estado.resultados = resultados;

            if (!estado.cancelado) {
                finalizarProcessamento();
            } else {
                finalizarProcessamento(true);
            }

        } catch (erro) {
            console.error('❌ Erro:', erro);
            alert(`❌ Erro: ${erro.message}`);
            estado.processando = false;
            fecharModal();
        }
    }

    function finalizarProcessamento(cancelado = false) {
        const tempoTotal = Math.floor((Date.now() - estado.iniciado) / 1000);
        const velocidade = tempoTotal > 0 ? Math.round((estado.totalProcessados / tempoTotal) * 60) : 0;
        const taxaSucesso = estado.totalProcessados > 0
            ? ((estado.totalSucesso / estado.totalProcessados) * 100).toFixed(1)
            : 0;

        const resumo = checkpointManager.getResumo();

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(cancelado ? '⚠️ PROCESSAMENTO CANCELADO!' : '🏁 PROCESSAMENTO FINALIZADO!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('  ESTA EXECUÇÃO:');
        console.log(`    ✅ Sucesso: ${estado.totalSucesso}`);
        console.log(`    ❌ Erros: ${estado.totalErro}`);
        console.log(`    ⏱️ Timeouts: ${estado.totalTimeout}`);
        console.log(`    ⏭️ Pulados (sucesso anterior): ${estado.totalPulados}`);
        console.log(`    🔄 Retentativas: ${estado.totalRetentativas}`);
        console.log(`    ⏱️ Tempo: ${tempoTotal}s (${Math.floor(tempoTotal/60)}min)`);
        console.log(`    ⚡ Velocidade: ${velocidade} reg/min`);
        console.log(`    📊 Taxa: ${taxaSucesso}%`);
        console.log('');
        console.log('  CHECKPOINT PERMANENTE:');
        console.log(`    💾 Total IDs com sucesso: ${resumo.idsSucesso}`);
        console.log(`    📊 Total execuções: ${resumo.totalExecucoes}`);
        if (CONFIG.habilitarFiltroData) {
            console.log('');
            console.log('  FILTRO DE PERÍODO:');
            console.log(`    📅 De ${CONFIG.dataInicio} até ${CONFIG.dataFim}`);
        }
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        atualizarModal(cancelado ? 'Cancelado pelo usuário' : 'Finalizado!', true);

        setTimeout(() => {
            const mensagem = cancelado
                ? `⚠️ PROCESSAMENTO CANCELADO\\n\\n`
                : `🎊 REENVIO FINALIZADO!\\n\\n`;

            let textoCompleto = mensagem +
                `ESTA EXECUÇÃO:\\n` +
                `  ✅ Sucesso: ${estado.totalSucesso}\\n` +
                `  ❌ Erros: ${estado.totalErro}\\n` +
                `  ⏱️ Timeouts: ${estado.totalTimeout}\\n`;

            if (estado.totalPulados > 0) {
                textoCompleto += `  ⏭️ Pulados: ${estado.totalPulados}\\n`;
            }

            textoCompleto +=
                `\\nCHECKPOINT PERMANENTE:\\n` +
                `  💾 Total com sucesso: ${resumo.idsSucesso}\\n` +
                `  📊 Total execuções: ${resumo.totalExecucoes}\\n`;

            if (CONFIG.habilitarFiltroData) {
                textoCompleto += `\\nPERÍODO FILTRADO:\\n` +
                                `  📅 ${CONFIG.dataInicio} até ${CONFIG.dataFim}\\n`;
            }

            textoCompleto += `\\nExportar relatório CSV?`;

            const confirmExport = confirm(textoCompleto);

            if (confirmExport) {
                exportarCSV();
            }

            fecharModal();
            estado.processando = false;
        }, 500);
    }

    // ============================================
    // 🎨 INTERFACE COM CONTROLES DINÂMICOS
    // ============================================

    function criarModal() {
        if (document.getElementById('apiDirectModal')) return;

        const modal = document.createElement('div');
        modal.id = 'apiDirectModal';
        modal.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(0,0,0,0.7); z-index: 999999; display: flex;
                        align-items: center; justify-content: center;">
                <div style="background: white; padding: 30px; border-radius: 8px;
                            min-width: 650px; max-width: 850px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <h2 style="margin: 0 0 20px 0; color: #00bcd4; text-align: center;">
                        🚀 API Direct v13.3.4
                    </h2>

                    <div id="apiStatus" style="font-size: 14px; color: #666; margin-bottom: 15px; text-align: center; font-weight: bold;">
                        Iniciando...
                    </div>

                    <!-- ✨ NOVO: Controles de Workers -->
                    <div style="background: #e3f2fd; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                        <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 15px; align-items: center;">
                            <div>
                                <label style="font-size: 11px; font-weight: bold; display: block; margin-bottom: 5px;">
                                    Mín Workers:
                                </label>
                                <input type="number" id="workersMin" value="${CONFIG.concorrenciaMinima}"
                                       min="1" max="200"
                                       style="width: 100%; padding: 6px; border: 1px solid #90caf9; border-radius: 4px;">
                            </div>
                            
                            <div style="text-align: center;">
                                <div style="font-weight: bold; font-size: 12px; color: #666; margin-bottom: 5px;">
                                    Workers Atual
                                </div>
                                <div style="font-size: 24px; font-weight: bold; color: #00bcd4; padding: 5px 0;">
                                    <span id="apiWorkers">${CONFIG.concorrenciaInicial}</span>
                                </div>
                                <div style="display: flex; gap: 5px; justify-content: center; margin-top: 5px;">
                                    <button onclick="window.ajustarWorkers(-5)"
                                            style="padding: 5px 12px; background: #ff9800; color: white; border: none;
                                                   border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">
                                        -5
                                    </button>
                                    <button onclick="window.ajustarWorkers(+5)"
                                            style="padding: 5px 12px; background: #4caf50; color: white; border: none;
                                                   border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;">
                                        +5
                                    </button>
                                </div>
                            </div>
                            
                            <div>
                                <label style="font-size: 11px; font-weight: bold; display: block; margin-bottom: 5px;">
                                    Máx Workers:
                                </label>
                                <input type="number" id="workersMax" value="${CONFIG.concorrenciaMaxima}"
                                       min="1" max="200"
                                       style="width: 100%; padding: 6px; border: 1px solid #90caf9; border-radius: 4px;">
                            </div>
                        </div>
                        
                        <button onclick="window.aplicarLimitesWorkers()"
                                style="width: 100%; margin-top: 10px; padding: 8px; background: #2196f3; color: white;
                                       border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">
                            ✅ Aplicar Limites
                        </button>
                    </div>

                    <div style="background: #f5f5f5; padding: 20px; border-radius: 4px; margin-bottom: 20px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; font-size: 13px;">
                            <div>
                                <strong>📄 Páginas:</strong>
                                <span id="apiPaginas" style="float: right; font-weight: bold;">0/0</span>
                            </div>
                            <div>
                                <strong>📊 Buscados:</strong>
                                <span id="apiBuscados" style="float: right; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>⚙️ Processados:</strong>
                                <span id="apiProcessados" style="float: right; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>✅ Sucesso:</strong>
                                <span id="apiSucesso" style="float: right; color: green; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>❌ Erros:</strong>
                                <span id="apiErros" style="float: right; color: red; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>⏱️ Timeouts:</strong>
                                <span id="apiTimeouts" style="float: right; color: orange; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>⏭️ Pulados:</strong>
                                <span id="apiPulados" style="float: right; color: #9c27b0; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>🔄 Retries:</strong>
                                <span id="apiRetries" style="float: right; color: #795548; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>⏱️ Tempo:</strong>
                                <span id="apiTempo" style="float: right; font-weight: bold;">0s</span>
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
                            <span>Progresso</span>
                            <span id="apiProgresso">0%</span>
                        </div>
                        <div style="background: #e0e0e0; height: 30px; border-radius: 4px; overflow: hidden;">
                            <div id="apiBarraProgresso" style="background: linear-gradient(90deg, #00bcd4, #0097a7);
                                 height: 100%; width: 0%; transition: width 0.3s; display: flex; align-items: center;
                                 justify-content: center; color: white; font-weight: bold; font-size: 14px;">
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
                            <span>Taxa de Sucesso</span>
                            <span id="apiTaxaSucesso">0%</span>
                        </div>
                        <div style="background: #e0e0e0; height: 20px; border-radius: 4px; overflow: hidden;">
                            <div id="apiBarraSucesso" style="background: linear-gradient(90deg, #4caf50, #2e7d32);
                                 height: 100%; width: 0%; transition: width 0.3s;">
                            </div>
                        </div>
                    </div>

                    <div id="apiBotoesControle" style="display: flex; gap: 10px; justify-content: center; margin-bottom: 10px;">
                        <button id="btnPausar" onclick="window.pausarScript()"
                                style="padding: 10px 20px; background: #ff9800; color: white; border: none;
                                       border-radius: 4px; cursor: pointer; font-weight: bold;">
                            ⏸️ Pausar
                        </button>
                        <button id="btnCancelar" onclick="window.cancelarScript()"
                                style="padding: 10px 20px; background: #f44336; color: white; border: none;
                                       border-radius: 4px; cursor: pointer; font-weight: bold;">
                            🛑 Cancelar
                        </button>
                    </div>

                    <div id="apiBotoesFinais" style="display: none; margin-top: 20px; text-align: center;">
                        <button onclick="document.getElementById('exportarCSVBtn').click()"
                                style="padding: 10px 20px; background: #4caf50; color: white; border: none;
                                       border-radius: 4px; cursor: pointer; margin-right: 10px;">
                            💾 Exportar CSV
                        </button>
                        <button onclick="document.getElementById('apiDirectModal').remove()"
                                style="padding: 10px 20px; background: #666; color: white; border: none;
                                       border-radius: 4px; cursor: pointer;">
                            ✖️ Fechar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        window.pausarScript = function() {
            if (estado.pausado) {
                continuarProcessamento();
            } else {
                pausarProcessamento();
            }
        };

        window.cancelarScript = cancelarProcessamento;
    }

    function atualizarBotoesDuranteExecucao() {
        const btnPausar = document.getElementById('btnPausar');
        if (btnPausar) {
            if (estado.pausado) {
                btnPausar.textContent = '▶️ Continuar';
                btnPausar.style.background = '#4caf50';
            } else {
                btnPausar.textContent = '⏸️ Pausar';
                btnPausar.style.background = '#ff9800';
            }
        }
    }

    function atualizarModal(status, finalizado = false) {
        const progresso = estado.totalBuscados > 0
            ? Math.floor((estado.totalProcessados / estado.totalBuscados) * 100)
            : 0;
        const tempoDecorrido = Math.floor((Date.now() - estado.iniciado) / 1000);
        const velocidade = tempoDecorrido > 0 ? Math.round((estado.totalProcessados / tempoDecorrido) * 60) : 0;
        const taxaSucesso = estado.totalProcessados > 0
            ? ((estado.totalSucesso / estado.totalProcessados) * 100).toFixed(1)
            : 0;

        const elementos = {
            apiStatus: status || (estado.pausado ? '⏸️ PAUSADO' : 'Processando...'),
            apiPaginas: `${estado.paginaAtual}/${estado.totalPaginas || '?'}`,
            apiBuscados: estado.totalBuscados,
            apiProcessados: estado.totalProcessados,
            apiSucesso: estado.totalSucesso,
            apiErros: estado.totalErro,
            apiTimeouts: estado.totalTimeout,
            apiPulados: estado.totalPulados,
            apiRetries: estado.totalRetentativas,
            apiWorkers: estado.concorrenciaAtual,
            apiProgresso: `${progresso}%`,
            apiTempo: `${tempoDecorrido}s`,
            apiTaxaSucesso: `${taxaSucesso}%`
        };

        Object.entries(elementos).forEach(([id, valor]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = valor;
        });

        const barra = document.getElementById('apiBarraProgresso');
        if (barra) {
            barra.style.width = `${progresso}%`;
            barra.textContent = `${progresso}%`;
        }

        const barraSucesso = document.getElementById('apiBarraSucesso');
        if (barraSucesso) {
            barraSucesso.style.width = `${taxaSucesso}%`;
        }

        if (finalizado) {
            const controles = document.getElementById('apiBotoesControle');
            const finais = document.getElementById('apiBotoesFinais');
            if (controles) controles.style.display = 'none';
            if (finais) finais.style.display = 'block';
        }
    }

    function fecharModal() {
        const modal = document.getElementById('apiDirectModal');
        if (modal) modal.remove();
    }

    function exportarCSV() {
        const linhas = [
            ['ID', 'CPF', 'Vacina', 'Status', 'HTTP Status', 'Tentativa', 'Erro', 'Timestamp'].join(';')
        ];

        estado.resultados.forEach(r => {
            linhas.push([
                r.id,
                r.cpf,
                r.vacina,
                r.status,
                r.statusCode,
                r.tentativa,
                (r.erro || '').replace(/;/g, ','),
                r.timestamp
            ].join(';'));
        });

        const resumo = checkpointManager.getResumo();

        linhas.push('');
        linhas.push('ESTATÍSTICAS DESTA EXECUÇÃO');
        linhas.push(`Total Buscados;${estado.totalBuscados}`);
        linhas.push(`Total Páginas;${estado.paginaAtual}`);
        linhas.push(`Total Processados;${estado.totalProcessados}`);
        linhas.push(`Total Pulados (Sucesso Anterior);${estado.totalPulados}`);
        linhas.push(`Sucesso;${estado.totalSucesso}`);
        linhas.push(`Erros;${estado.totalErro}`);
        linhas.push(`Timeouts;${estado.totalTimeout}`);
        linhas.push(`Retentativas;${estado.totalRetentativas}`);
        linhas.push(`Tempo Total;${Math.floor((Date.now() - estado.iniciado) / 1000)}s`);
        linhas.push(`Velocidade;${Math.round((estado.totalProcessados / ((Date.now() - estado.iniciado) / 1000)) * 60)} reg/min`);
        linhas.push(`Taxa Sucesso;${((estado.totalSucesso / estado.totalProcessados) * 100).toFixed(1)}%`);

        linhas.push('');
        linhas.push('CHECKPOINT PERMANENTE');
        linhas.push(`Total IDs com Sucesso;${resumo.idsSucesso}`);
        linhas.push(`Total Execuções;${resumo.totalExecucoes}`);

        if (CONFIG.habilitarFiltroData) {
            linhas.push('');
            linhas.push('FILTRO DE PERÍODO');
            linhas.push(`Data Início;${CONFIG.dataInicio}`);
            linhas.push(`Data Fim;${CONFIG.dataFim}`);
        }

        const csv = '\uFEFF' + linhas.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `reenvio_api_v13.3.4_${new Date().toISOString().split('T')[0]}.csv`;
        link.id = 'exportarCSVBtn';
        link.click();

        console.log('💾 CSV exportado!');
    }

    // ============================================
    // ⚙️ CONFIGURAÇÕES
    // ============================================

    function abrirConfiguracoes() {
        const modalConfig = document.createElement('div');
        modalConfig.id = 'modalConfiguracoes';
        modalConfig.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(0,0,0,0.7); z-index: 999999; display: flex;
                        align-items: center; justify-content: center;">
                <div style="background: white; padding: 30px; border-radius: 8px;
                            width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <h2 style="margin: 0 0 20px 0; color: #00bcd4;">⚙️ Configurações</h2>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            ⚡ Concorrência Inicial:
                        </label>
                        <input type="number" id="cfgConcorrenciaInicial" value="${CONFIG.concorrenciaInicial}"
                               min="1" max="100"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            🚀 Concorrência Máxima:
                        </label>
                        <input type="number" id="cfgConcorrenciaMaxima" value="${CONFIG.concorrenciaMaxima}"
                               min="1" max="200"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            📄 Registros por Página:
                        </label>
                        <input type="number" id="cfgRegistrosPorPagina" value="${CONFIG.registrosPorPagina}"
                               min="10" max="1000" step="10"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <small style="color: #666;">⚠️ Recomendado: 15 (mesmo valor da aplicação)</small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            ⏱️ Timeout por Requisição (ms):
                        </label>
                        <input type="number" id="cfgTimeoutRequisicao" value="${CONFIG.timeoutRequisicao}"
                               min="5000" max="120000" step="1000"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <small style="color: #666;">
                            Tempo máximo de espera por requisição (ms). 
                            <strong>${(CONFIG.timeoutRequisicao / 1000)}s atual</strong>
                        </small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            🔄 Máximo de Retentativas:
                        </label>
                        <input type="number" id="cfgMaxRetentativas" value="${CONFIG.maxRetentativas}"
                               min="0" max="5"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            📄 Limite Máximo de Páginas:
                        </label>
                        <input type="number" id="cfgLimitePaginas" value="${CONFIG.limiteMaximoPaginas}"
                               min="10" max="1000" step="10"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <small style="color: #666;">Segurança para não buscar infinitamente</small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="cfgAjusteAuto" ${CONFIG.ajusteAutomatico ? 'checked' : ''}
                                   style="margin-right: 10px; width: 20px; height: 20px; cursor: pointer;">
                            <span style="font-weight: bold;">🎯 Ajuste Automático de Concorrência</span>
                        </label>
                    </div>

                    <div style="margin-bottom: 20px; background: #e3f2fd; padding: 15px; border-radius: 4px;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="cfgCheckpoint" ${CONFIG.habilitarCheckpoint ? 'checked' : ''}
                                   style="margin-right: 10px; width: 20px; height: 20px; cursor: pointer;">
                            <span style="font-weight: bold;">💾 Checkpoint Permanente</span>
                        </label>
                        <small style="color: #666; display: block; margin-top: 5px;">
                            ✅ Salva apenas sucessos<br>
                            ✅ Acumula entre execuções<br>
                            ✅ Nunca limpa automaticamente
                        </small>
                    </div>

                    <hr style="margin: 25px 0; border: none; border-top: 2px solid #e0e0e0;">

                    <div style="margin-bottom: 20px; background: #fff3e0; padding: 15px; border-radius: 4px; border: 2px solid #ff9800;">
                        <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 15px;">
                            <input type="checkbox" id="cfgFiltroData" ${CONFIG.habilitarFiltroData ? 'checked' : ''}
                                   onchange="document.getElementById('divDatasConfig').style.display = this.checked ? 'block' : 'none'"
                                   style="margin-right: 10px; width: 20px; height: 20px; cursor: pointer;">
                            <span style="font-weight: bold; font-size: 16px;">📅 Filtro de Período de Datas</span>
                        </label>

                        <div id="divDatasConfig" style="display: ${CONFIG.habilitarFiltroData ? 'block' : 'none'};">
                            <div style="margin-bottom: 15px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                                    📆 Data Início:
                                </label>
                                <input type="date" id="cfgDataInicio" value="${CONFIG.dataInicio}"
                                       style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                <small style="color: #666;">Data da vacinação (início do período)</small>
                            </div>

                            <div style="margin-bottom: 10px;">
                                <label style="display: block; margin-bottom: 5px; font-weight: bold; color: #555;">
                                    📆 Data Fim:
                                </label>
                                <input type="date" id="cfgDataFim" value="${CONFIG.dataFim}"
                                       style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                                <small style="color: #666;">Data da vacinação (fim do período)</small>
                            </div>

                            <div style="background: #e8f5e9; padding: 10px; border-radius: 4px; margin-top: 10px;">
                                <small style="color: #2e7d32; font-weight: bold;">
                                    💡 Dica: Use este filtro para processar registros de um período específico.<br>
                                    ⚠️ Desmarque para buscar TODOS os registros (sem filtro de data).
                                </small>
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button onclick="document.getElementById('modalConfiguracoes').remove()"
                                style="padding: 10px 20px; background: #666; color: white; border: none;
                                       border-radius: 4px; cursor: pointer;">
                            Cancelar
                        </button>
                        <button id="btnSalvarConfig"
                                style="padding: 10px 20px; background: #4caf50; color: white; border: none;
                                       border-radius: 4px; cursor: pointer; font-weight: bold;">
                            💾 Salvar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalConfig);

        document.getElementById('btnSalvarConfig').onclick = () => {
            CONFIG.concorrenciaInicial = parseInt(document.getElementById('cfgConcorrenciaInicial').value);
            CONFIG.concorrenciaMaxima = parseInt(document.getElementById('cfgConcorrenciaMaxima').value);
            CONFIG.registrosPorPagina = parseInt(document.getElementById('cfgRegistrosPorPagina').value);
            CONFIG.timeoutRequisicao = parseInt(document.getElementById('cfgTimeoutRequisicao').value);
            CONFIG.maxRetentativas = parseInt(document.getElementById('cfgMaxRetentativas').value);
            CONFIG.limiteMaximoPaginas = parseInt(document.getElementById('cfgLimitePaginas').value);
            CONFIG.ajusteAutomatico = document.getElementById('cfgAjusteAuto').checked;
            CONFIG.habilitarCheckpoint = document.getElementById('cfgCheckpoint').checked;

            if (CONFIG.timeoutRequisicao < 5000) {
                alert('⚠️ Timeout muito baixo! Mínimo recomendado: 5000ms (5s)');
                return;
            }

            if (CONFIG.timeoutRequisicao > 120000) {
                if (!confirm(
                    '⚠️ Timeout muito alto!\\n\\n' +
                    `Timeout configurado: ${CONFIG.timeoutRequisicao}ms (${CONFIG.timeoutRequisicao/1000}s)\\n\\n` +
                    'Timeouts altos podem travar o processamento se houver problemas na rede.\\n\\n' +
                    'Continuar mesmo assim?'
                )) {
                    return;
                }
            }

            CONFIG.habilitarFiltroData = document.getElementById('cfgFiltroData').checked;
            CONFIG.dataInicio = document.getElementById('cfgDataInicio').value;
            CONFIG.dataFim = document.getElementById('cfgDataFim').value;

            if (CONFIG.habilitarFiltroData) {
                const inicio = new Date(CONFIG.dataInicio);
                const fim = new Date(CONFIG.dataFim);

                if (inicio > fim) {
                    alert('⚠️ Data de início não pode ser maior que data de fim!');
                    return;
                }

                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);

                if (fim > hoje) {
                    if (!confirm(
                        '⚠️ Data de fim está no futuro!\\n\\n' +
                        `Data fim: ${CONFIG.dataFim}\\n` +
                        `Hoje: ${hoje.toISOString().split('T')[0]}\\n\\n` +
                        'Continuar mesmo assim?'
                    )) {
                        return;
                    }
                }
            }

            localStorage.setItem('RNDS_CONFIG', JSON.stringify(CONFIG));

            let msg = '✅ Configurações salvas!\\n\\n';
            msg += `⏱️ Timeout: ${CONFIG.timeoutRequisicao}ms (${CONFIG.timeoutRequisicao/1000}s)\\n`;
            
            if (CONFIG.habilitarFiltroData) {
                msg += `\\n📅 Filtro de período ATIVO:\\n${CONFIG.dataInicio} até ${CONFIG.dataFim}`;
            } else {
                msg += '\\n📅 Filtro de período DESATIVADO (buscará todos os registros)';
            }

            alert(msg);
            document.getElementById('modalConfiguracoes').remove();

            console.log('⚙️ Novas configurações:', CONFIG);
        };
    }

    function carregarConfiguracoes() {
        const configSalva = localStorage.getItem('RNDS_CONFIG');
        if (configSalva) {
            try {
                const config = JSON.parse(configSalva);
                Object.assign(CONFIG, config);
                console.log('✅ Configurações carregadas:', CONFIG);
            } catch (e) {
                console.warn('⚠️ Erro ao carregar configurações');
            }
        }
    }

    function gerenciarCheckpoint() {
        const resumo = checkpointManager.getResumo();

        if (!resumo) {
            alert('ℹ️ Nenhum checkpoint encontrado');
            return;
        }

        const historico = checkpointManager.getHistorico();
        let mensagem = '💾 CHECKPOINT PERMANENTE\\n\\n' +
                      `Data: ${resumo.dataCheckpoint.toLocaleString()}\\n` +
                      `IDs com SUCESSO: ${resumo.idsSucesso}\\n` +
                      `Execuções: ${resumo.totalExecucoes}\\n\\n`;

        if (historico.length > 0) {
            mensagem += 'HISTÓRICO:\\n';
            historico.slice(-5).forEach(h => {
                mensagem += `  ${h.numero}. ${h.data} - ${h.sucessos} sucessos\\n`;
            });
            mensagem += '\\n';
        }

        mensagem +=
            '✅ IDs com sucesso são PERMANENTES\\n' +
            '✅ Serão pulados em TODAS as execuções\\n' +
            '🔄 Erros/timeouts tentados novamente\\n\\n' +
            'Deseja LIMPAR o checkpoint permanente?';

        if (confirm(mensagem)) {
            checkpointManager.limpar();
        }
    }

    // ============================================
    // 🎨 TOOLBAR
    // ============================================

    function criarBotoesToolbar() {
        const toolbar = document.querySelector('.main-theme-options');
        if (!toolbar) {
            console.log('⏳ Aguardando toolbar...');
            setTimeout(criarBotoesToolbar, 500);
            return;
        }

        console.log('✅ Toolbar encontrada!');

        const divider = document.createElement('nab-divider');
        divider.setAttribute('role', 'separator');
        divider.className = 'nab-divider nab-divider-white nab-divider-vertical';
        divider.setAttribute('aria-orientation', 'vertical');

        const btnToken = document.createElement('button');
        btnToken.id = 'btnVerToken';
        btnToken.className = 'nab-focus-indicator nab-icon-button nab-button-base';
        btnToken.setAttribute('nab-icon-button', '');
        btnToken.title = 'Ver/Inserir Token';
        btnToken.innerHTML = `
            <span class="nab-button-wrapper">
                <span class="icon-emoji" style="font-size: 20px; color: #ff9800;">🔑</span>
            </span>
        `;
        btnToken.onclick = () => {
            if (TOKEN_GLOBAL) {
                const copiar = confirm(`🔑 TOKEN:\\n\\n${TOKEN_GLOBAL}\\n\\n\\nCopiar?`);
                if (copiar) {
                    navigator.clipboard.writeText(TOKEN_GLOBAL);
                    alert('✅ Token copiado!');
                }
            } else {
                solicitarTokenManual();
            }
        };

        const btnCheckpoint = document.createElement('button');
        btnCheckpoint.id = 'btnCheckpoint';
        btnCheckpoint.className = 'nab-focus-indicator nab-icon-button nab-button-base';
        btnCheckpoint.setAttribute('nab-icon-button', '');
        btnCheckpoint.title = 'Gerenciar Checkpoint';
        btnCheckpoint.innerHTML = `
            <span class="nab-button-wrapper">
                <span class="icon-emoji" style="font-size: 20px; color: #2196f3;">💾</span>
            </span>
        `;
        btnCheckpoint.onclick = gerenciarCheckpoint;

        const btnConfig = document.createElement('button');
        btnConfig.id = 'btnConfiguracoes';
        btnConfig.className = 'nab-focus-indicator nab-icon-button nab-button-base';
        btnConfig.setAttribute('nab-icon-button', '');
        btnConfig.title = 'Configurações';
        btnConfig.innerHTML = `
            <span class="nab-button-wrapper">
                <span class="icon-emoji" style="font-size: 20px; color: #9c27b0;">⚙️</span>
            </span>
        `;
        btnConfig.onclick = abrirConfiguracoes;

        const btnReenviar = document.createElement('button');
        btnReenviar.id = 'btnReenviarAPI';
        btnReenviar.className = 'nab-focus-indicator nab-icon-button nab-button-base';
        btnReenviar.setAttribute('nab-icon-button', '');
        btnReenviar.title = 'Reenviar Vacinas';
        btnReenviar.innerHTML = `
            <span class="nab-button-wrapper">
                <span class="icon-emoji" style="font-size: 20px; color: #00bcd4;">🚀</span>
            </span>
        `;
        btnReenviar.onclick = iniciarReenvioAPI;

        const btnGlobal = toolbar.querySelector('button[nab-icon-button]');
        if (btnGlobal) {
            toolbar.insertBefore(divider, btnGlobal);
            toolbar.insertBefore(btnToken, btnGlobal);
            toolbar.insertBefore(btnCheckpoint, btnGlobal);
            toolbar.insertBefore(btnConfig, btnGlobal);
            toolbar.insertBefore(btnReenviar, btnGlobal);
        } else {
            toolbar.appendChild(divider);
            toolbar.appendChild(btnToken);
            toolbar.appendChild(btnCheckpoint);
            toolbar.appendChild(btnConfig);
            toolbar.appendChild(btnReenviar);
        }

        console.log('✅ Botões adicionados!');
        atualizarBotaoToken(!!TOKEN_GLOBAL);

        if (checkpointManager.getResumo() && checkpointManager.checkpoint.idsSucesso.length > 0) {
            const icon = btnCheckpoint.querySelector('span.icon-emoji');
            if (icon) icon.style.color = '#4caf50';
        }
    }

    // ============================================
    // 🚀 INICIALIZAÇÃO
    // ============================================

    function inicializar() {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🚀 SPRNDS - API Direct v13.3.4');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✨ NOVO NA v13.3.4:');
        console.log('  • Ajuste automático CORRIGIDO (funciona durante processamento)');
        console.log('  • Controles dinâmicos de workers no modal');
        console.log('  • Ajuste de limites min/max em tempo real');
        console.log('  • Botões +/- para ajuste rápido');
        console.log('  • Feedback visual de mudanças');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        carregarConfiguracoes();
        capturarToken();
        criarBotoesToolbar();

        const resumo = checkpointManager.getResumo();
        if (resumo && resumo.idsSucesso > 0) {
            console.log('💾 Checkpoint permanente detectado:');
            console.log(`   • Data: ${resumo.dataCheckpoint.toLocaleString()}`);
            console.log(`   • IDs com SUCESSO: ${resumo.idsSucesso}`);
            console.log(`   • Execuções anteriores: ${resumo.totalExecucoes}`);
            console.log('');
        }

        if (CONFIG.habilitarFiltroData) {
            console.log('📅 Filtro de período ATIVO:');
            console.log(`   • De: ${CONFIG.dataInicio}`);
            console.log(`   • Até: ${CONFIG.dataFim}`);
            console.log('');
        } else {
            console.log('📅 Filtro de período DESATIVADO (buscando todos)');
            console.log('');
        }

        console.log('💡 Sistema pronto!');
        console.log('');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
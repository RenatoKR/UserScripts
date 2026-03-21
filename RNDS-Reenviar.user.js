// ==UserScript==
// @name         SPRNDS - Reenviar v13.4.9
// @namespace    http://tampermonkey.net/
// @version      13.4.9
// @description  Auto-tuning inteligente + busca por status configurável (PENDING/ERROR) + Otimizações + Fix Race Condition + Fix Await Workers + Fix quebras de linha nos modais
// @author       Renato Krebs Rosa
// @match        *://*/rnds/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @supportURL   https://github.com/RenatoKR/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';

    const VERSAO = '13.4.9';

    // ============================================
    // ⚙️ CONFIGURAÇÕES PADRÃO
    // ============================================
    const dataAtual = new Date();
    dataAtual.setHours(dataAtual.getHours() - 3);
    const hojeStr = dataAtual.toISOString().split('T')[0];

    const CONFIG = {
        concorrenciaInicial: 100,
        concorrenciaMaxima: 500,
        concorrenciaMinima: 5,
        registrosPorPagina: 500,
        pausaEntreLotes: 200,
        timeoutRequisicao: 120000,
        maxRetentativas: 2,
        ajusteAutomatico: true,
        limiteMaximoPaginas: 100,
        buscarTodasPaginas: true,
        habilitarCheckpoint: true,
        salvarCheckpointACada: 10,
        habilitarFiltroData: false,
        dataInicio: '2020-01-01',
        dataFim: hojeStr,
        autoTuningAgressivo: false,
        intervaloAnalise: 10,
        logDetalhado: true,
        statusBuscar: 'AMBOS' // 'ERROR', 'PENDING', 'AMBOS'
    };

    // ============================================
    // 💾 GERENCIADOR DE CHECKPOINT PERMANENTE
    // ============================================

    class CheckpointManager {
        constructor() {
            this.STORAGE_KEY = 'RNDS_CHECKPOINT';
            this.checkpoint = this.carregar() || this.criar();
            this.idsSet = new Set(this.checkpoint.idsSucesso);
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
                versao: VERSAO,
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
            this.execucaoAtualIdsSet = new Set();

            console.log('💾 Nova execução iniciada');
            console.log(`   • IDs já com sucesso (permanentes): ${this.checkpoint.idsSucesso.length}`);
            this.salvar();
        }

        registrarProcessado(id, resultado) {
            if (!this.checkpoint || !this.execucaoAtual) return;

            if (resultado.status === 'SUCESSO') {
                if (!this.idsSet.has(id)) {
                    this.checkpoint.idsSucesso.push(id);
                    this.idsSet.add(id);
                    this.checkpoint.estatisticas.totalSucesso++;
                }

                if (!this.execucaoAtualIdsSet.has(id)) {
                    this.execucaoAtual.idsSucesso.push(id);
                    this.execucaoAtualIdsSet.add(id);
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
            return this.idsSet && this.idsSet.has(id);
        }

        limpar() {
            if (confirm(
                '⚠️ ATENÇÃO: LIMPAR CHECKPOINT PERMANENTE\n\n' +
                `Você tem ${this.checkpoint.idsSucesso.length} IDs com sucesso salvos.\n\n` +
                'Ao limpar, TODOS os sucessos anteriores serão perdidos!\n' +
                'Todos os registros serão processados novamente do zero.\n\n' +
                'Tem certeza que deseja LIMPAR?'
            )) {
                localStorage.removeItem(this.STORAGE_KEY);
                this.checkpoint = this.criar();
                this.idsSet = new Set();
                console.log('🗑️ Checkpoint limpo - todos os IDs serão reprocessados');
                alert('✅ Checkpoint limpo com sucesso!\n\nNa próxima execução, todos os registros serão processados.');
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
        resultados: [],
        workersAtivos: 0,
        metricsWorkers: {},
        metricsLatencia: {
            historico: [],
            p50: 0,
            p95: 0,
            p99: 0,
            media: 0,
            porConcorrencia: {}
        },
        ajustesHistorico: []
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
            '🔑 TOKEN NÃO DETECTADO\n\n' +
            'Passos:\n' +
            '1. F12 → Network\n' +
            '2. Faça uma pesquisa\n' +
            '3. Clique em "/api/vaccine-sync"\n' +
            '4. Copie o header "Authorization"\n\n' +
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
    // 🌐 API - PAGINAÇÃO COM FILTRO DE DATA E STATUS
    // ============================================

    async function buscarVacinasComErro(page = 0, limit = 15, status = 'ERROR') {
        let url = `/rnds/api/vaccine-sync?sort=false:desc&page=${page}&limit=${limit}&sendStatus=${status}`;

        if (CONFIG.habilitarFiltroData) {
            url += `&between=vaccineDate,${CONFIG.dataInicio},${CONFIG.dataFim}`;
        }

        console.log(`🔍 Buscando página ${page} (status: ${status})...`);
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
                currentPage: page,
                status: status
            };

        } catch (erro) {
            console.error(`❌ Erro ao buscar página ${page} (${status}):`, erro);
            return {
                content: [],
                totalElements: 0,
                totalPages: 0,
                currentPage: page,
                status: status
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

        const statusTexto = CONFIG.statusBuscar === 'ERROR' ? 'ERROR' :
                           CONFIG.statusBuscar === 'PENDING' ? 'PENDING' :
                           'ERROR + PENDING';
        console.log(`📌 Status: ${statusTexto}`);

        if (CONFIG.habilitarFiltroData) {
            console.log(`📅 Filtro de período: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`);
        } else {
            console.log('📅 Sem filtro de período (buscando todos)');
        }

        console.log('');

        const registrosMap = new Map();

        const statusParaBuscar = [];
        if (CONFIG.statusBuscar === 'ERROR') {
            statusParaBuscar.push('ERROR');
        } else if (CONFIG.statusBuscar === 'PENDING') {
            statusParaBuscar.push('PENDING');
        } else { // AMBOS
            statusParaBuscar.push('ERROR', 'PENDING');
        }

        for (const status of statusParaBuscar) {
            console.log('');
            console.log(`───────────────────────────────────────────────────────────`);
            console.log(`📋 Buscando registros com status: ${status}`);
            console.log(`───────────────────────────────────────────────────────────`);

            let page = 0;
            let totalElementosNaBase = 0;
            let totalPaginasNaBase = 0;

            while (page < CONFIG.limiteMaximoPaginas) {
                if (estado.cancelado) {
                    console.log('⚠️ Busca cancelada pelo usuário');
                    break;
                }

                estado.paginaAtual = page + 1;

                atualizarModal(
                    `Buscando ${status} - página ${page + 1}${totalPaginasNaBase > 0 ? `/${totalPaginasNaBase}` : ''}...`
                );

                const dados = await buscarVacinasComErro(page, CONFIG.registrosPorPagina, status);

                if (dados.totalElements > 0 && dados.totalElements !== totalElementosNaBase) {
                    totalElementosNaBase = dados.totalElements;
                    console.log(`📊 API reporta: ${totalElementosNaBase} registros no total (${status})`);
                }

                if (dados.totalPages > 0 && dados.totalPages !== totalPaginasNaBase) {
                    totalPaginasNaBase = dados.totalPages;
                    estado.totalPaginas = totalPaginasNaBase;
                    console.log(`📄 API reporta: ${totalPaginasNaBase} páginas no total (${status})`);
                }

                if (!dados.content || dados.content.length === 0) {
                    console.log('');
                    console.log(`✅ FIM: Página vazia (sem registros ${status})`);
                    break;
                }

                const qtdNaPagina = dados.content.length;
                
                dados.content.forEach(reg => {
                    if (!registrosMap.has(reg.id)) {
                        registrosMap.set(reg.id, reg);
                    }
                });
                
                estado.totalBuscados = registrosMap.size;

                console.log(`   💾 Acumulado único: ${registrosMap.size} registros`);

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

                if (totalElementosNaBase > 0 && registrosMap.size >= totalElementosNaBase && statusParaBuscar.length === 1) {
                    console.log('');
                    console.log(`✅ FIM: Todos os ${totalElementosNaBase} registros foram buscados`);
                    break;
                }

                page++;
                await new Promise(r => setTimeout(r, 100));
            }

            if (page >= CONFIG.limiteMaximoPaginas) {
                console.warn('');
                console.warn(`⚠️ ATENÇÃO: Limite de segurança atingido (${CONFIG.limiteMaximoPaginas} páginas) para ${status}`);
            }
        }

        const todosRegistros = Array.from(registrosMap.values());

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 BUSCA FINALIZADA');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`✅ Registros únicos obtidos: ${todosRegistros.length}`);
        console.log(`📋 Status buscados: ${statusTexto}`);
        if (CONFIG.habilitarFiltroData) {
            console.log(`📅 Período filtrado: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`);
        }
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        return todosRegistros;
    }

    function registrarLatencia(tempo, isTimeout, statusCode) {
        const metrica = {
            tempo: tempo,
            workers: estado.concorrenciaAtual,
            timeout: isTimeout,
            statusCode: statusCode,
            timestamp: Date.now()
        };
        
        estado.metricsLatencia.historico.push(metrica);
        
        if (estado.metricsLatencia.historico.length > 100) {
            estado.metricsLatencia.historico.shift();
        }
        
        const nivel = estado.concorrenciaAtual;
        if (!estado.metricsLatencia.porConcorrencia[nivel]) {
            estado.metricsLatencia.porConcorrencia[nivel] = [];
        }
        estado.metricsLatencia.porConcorrencia[nivel].push(metrica);
        
        if (estado.metricsLatencia.porConcorrencia[nivel].length > 50) {
            estado.metricsLatencia.porConcorrencia[nivel].shift();
        }
    }

    async function reenviarVacina(registro, tentativa = 1) {
        const url = '/rnds/api/vaccine-sync/send-register';
        const inicioReq = Date.now();

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
            
            const latencia = Date.now() - inicioReq;
            registrarLatencia(latencia, false, response.status);

            const resultado = {
                id: registro.id,
                cpf: registro.pacientCpf || registro.patientCpf || 'N/A',
                vacina: registro.vaccineDescription || registro.vaccine || 'N/A',
                status: response.ok ? 'SUCESSO' : 'ERRO',
                statusCode: response.status,
                tentativa: tentativa,
                timestamp: new Date().toISOString(),
                latencia: latencia
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
            const latencia = Date.now() - inicioReq;
            
            if (isTimeout) {
                registrarLatencia(latencia, true, 0);
            }

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
                timestamp: new Date().toISOString(),
                latencia: latencia
            };

            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.registrarProcessado(registro.id, resultado);
            }

            return resultado;
        }
    }

    function percentil(arr, p) {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
        return sorted[index];
    }

    function analisarPerformance() {
        const hist = estado.metricsLatencia.historico;
        
        if (hist.length < 10) {
            return null;
        }
        
        const temposValidos = hist
            .filter(m => !m.timeout)
            .map(m => m.tempo);
        
        const totalTimeouts = hist.filter(m => m.timeout).length;
        const taxaTimeout = (totalTimeouts / hist.length) * 100;
        
        if (temposValidos.length === 0) {
            return {
                workers: estado.concorrenciaAtual,
                p50: CONFIG.timeoutRequisicao,
                p95: CONFIG.timeoutRequisicao,
                p99: CONFIG.timeoutRequisicao,
                media: CONFIG.timeoutRequisicao,
                taxaTimeout: 100,
                throughputTeorico: 0,
                amostra: hist.length
            };
        }
        
        const p50 = percentil(temposValidos, 0.50);
        const p95 = percentil(temposValidos, 0.95);
        const p99 = percentil(temposValidos, 0.99);
        const media = temposValidos.reduce((a, b) => a + b, 0) / temposValidos.length;
        
        const throughputTeorico = estado.concorrenciaAtual / (media / 1000);
        
        return {
            workers: estado.concorrenciaAtual,
            p50: Math.round(p50),
            p95: Math.round(p95),
            p99: Math.round(p99),
            media: Math.round(media),
            taxaTimeout: parseFloat(taxaTimeout.toFixed(2)),
            throughputTeorico: parseFloat(throughputTeorico.toFixed(2)),
            amostra: hist.length
        };
    }

    function detectarTendenciaLatencia() {
        const hist = estado.metricsLatencia.historico;
        if (hist.length < 20) return 'estavel';
        
        const primeira_metade = hist.slice(0, Math.floor(hist.length / 2))
            .filter(m => !m.timeout)
            .map(m => m.tempo);
        
        const segunda_metade = hist.slice(Math.floor(hist.length / 2))
            .filter(m => !m.timeout)
            .map(m => m.tempo);
        
        if (primeira_metade.length === 0 || segunda_metade.length === 0) {
            return 'estavel';
        }
        
        const media1 = primeira_metade.reduce((a, b) => a + b, 0) / primeira_metade.length;
        const media2 = segunda_metade.reduce((a, b) => a + b, 0) / segunda_metade.length;
        
        const variacao = ((media2 - media1) / media1) * 100;
        
        if (variacao > 20) return 'crescente';
        if (variacao < -20) return 'decrescente';
        return 'estavel';
    }

    async function processarComPool(registros) {
        const inicio = Date.now();
        const resultados = [];
        const resultadosRecentes = [];
        
        let proximoIndice = 0;
        const totalRegistros = registros.length;
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`🏊 POOL DE WORKERS DINÂMICO: ${estado.concorrenciaAtual} workers`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('💡 Cada worker pega o próximo item assim que termina');
        console.log('💡 Zero tempo ocioso - máxima eficiência');
        console.log('✨ Auto-tuning inteligente com análise de latência');
        console.log('');
        
        async function worker(workerId) {
            const metricas = {
                processados: 0,
                sucessos: 0,
                erros: 0,
                timeouts: 0,
                tempoTotal: 0,
                inicioWorker: Date.now()
            };
            
            estado.metricsWorkers[workerId] = metricas;
            estado.workersAtivos++;
            
            console.log(`🟢 Worker #${workerId} iniciado`);
            
            try {
                while (true) {
                    if (estado.workersAtivos > estado.concorrenciaAtual) {
                        if (CONFIG.logDetalhado) {
                            console.log(`📉 Worker #${workerId} encerrado (redução de concorrência)`);
                        }
                        break;
                    }

                    while (estado.pausado && !estado.cancelado) {
                        await new Promise(r => setTimeout(r, 500));
                    }
                    
                    if (estado.cancelado) {
                        console.log(`🛑 Worker #${workerId} cancelado`);
                        break;
                    }
                    
                    // ✨ FIX RACE CONDITION: Garantir operação atômica de captura do índice
                    let indice;
                    // Não precisamos de lock real no JS do browser pois é single-threaded, 
                    // mas precisamos garantir que o incremento aconteça ANTES de qualquer await
                    indice = proximoIndice++;
                    
                    if (indice >= totalRegistros) {
                        break;
                    }
                    
                    const registro = registros[indice];
                    
                    if (CONFIG.habilitarCheckpoint && checkpointManager.jaTemSucesso(registro.id)) {
                        estado.totalPulados++;
                        continue;
                    }
                    
                    const inicioRegistro = Date.now();
                    const resultado = await reenviarVacina(registro);
                    const tempoRegistro = Date.now() - inicioRegistro;
                    
                    metricas.processados++;
                    metricas.tempoTotal += tempoRegistro;
                    
                    if (resultado.status === 'SUCESSO') {
                        metricas.sucessos++;
                    } else if (resultado.status === 'TIMEOUT') {
                        metricas.timeouts++;
                    } else {
                        metricas.erros++;
                    }
                    
                    resultados.push(resultado);
                    resultadosRecentes.push(resultado);
                    estado.totalProcessados++;
                    
                    if (estado.totalProcessados % 5 === 0) {
                        atualizarModal();
                    }
                    
                    if (CONFIG.ajusteAutomatico && resultadosRecentes.length >= CONFIG.intervaloAnalise) {
                        ajustarConcorrencia(resultadosRecentes);
                        resultadosRecentes.length = 0;
                    }
                }
            } catch (err) {
                console.error(`❌ Erro inesperado no Worker #${workerId}:`, err);
            } finally {
                estado.workersAtivos--; // Garante que o worker sairá dos ativos mesmo em caso de erro crítico
                metricas.tempoTotal = Date.now() - metricas.inicioWorker;
                
                const velocidade = metricas.tempoTotal > 0 
                    ? (metricas.processados / (metricas.tempoTotal / 1000)).toFixed(2)
                    : 0;
                
                console.log(`🟠 Worker #${workerId} finalizado:`);
                console.log(`   • Processados: ${metricas.processados}`);
                console.log(`   • Sucessos: ${metricas.sucessos}`);
                console.log(`   • Erros: ${metricas.erros}`);
                console.log(`   • Timeouts: ${metricas.timeouts}`);
                console.log(`   • Tempo: ${(metricas.tempoTotal / 1000).toFixed(2)}s`);
                console.log(`   • Velocidade: ${velocidade} reg/s`);
            }
        }
        
        const workersPromises = new Set();
        let proximoWorkerId = 1;
        
        while (proximoIndice < totalRegistros && !estado.cancelado) {
            while (estado.workersAtivos < estado.concorrenciaAtual && proximoIndice < totalRegistros) {
                const id = proximoWorkerId++;
                const p = worker(id);
                workersPromises.add(p);
                p.finally(() => workersPromises.delete(p));
            }
            await new Promise(r => setTimeout(r, 250));
        }
        
        // ✨ FIX AWAIT WORKERS: Usa allSettled em vez de all para evitar cancelamento 
        // imediato caso uma promise rejeite, aguardando que TODAS encerrem limpas
        if (workersPromises.size > 0) {
            console.log(`⏳ Aguardando a finalização de ${workersPromises.size} workers ativos...`);
            await Promise.allSettled(Array.from(workersPromises)); 
        }
        
        if (CONFIG.habilitarCheckpoint) {
            checkpointManager.salvar();
        }
        
        const tempoTotal = Date.now() - inicio;
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`✅ POOL FINALIZADO: ${(tempoTotal / 1000).toFixed(2)}s`);
        console.log(`⚡ Velocidade média: ${((resultados.length / (tempoTotal / 1000)) * 60).toFixed(2)} reg/min`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        
        return resultados;
    }

    function ajustarConcorrencia(resultadosRecentes) {
        if (resultadosRecentes.length === 0) return;
        
        const analise = analisarPerformance();
        
        if (!analise) {
            if (CONFIG.logDetalhado) {
                console.log('📊 Dados insuficientes para análise (< 10 amostras)');
            }
            return;
        }
        
        const concorrenciaAnterior = estado.concorrenciaAtual;
        const tendencia = detectarTendenciaLatencia();
        
        if (CONFIG.logDetalhado) {
            console.log('');
            console.log('═══════════════════════════════════════════════════════════');
            console.log('📊 ANÁLISE DE PERFORMANCE DETALHADA');
            console.log('═══════════════════════════════════════════════════════════');
            console.log(`⚙️  Workers Atual: ${analise.workers}`);
            console.log(`📈 Latências:`);
            console.log(`   • P50 (mediana): ${analise.p50}ms`);
            console.log(`   • P95: ${analise.p95}ms`);
            console.log(`   • P99: ${analise.p99}ms`);
            console.log(`   • Média: ${analise.media}ms`);
            console.log(`⏱️  Timeout Config: ${CONFIG.timeoutRequisicao}ms`);
            console.log(`❌ Taxa Timeout: ${analise.taxaTimeout}%`);
            console.log(`📉 Tendência: ${tendencia}`);
            console.log(`⚡ Throughput Teórico: ${analise.throughputTeorico} req/s`);
            console.log(`📊 Amostra: ${analise.amostra} requisições`);
        }
        
        let decisao = null;
        let novoValor = concorrenciaAnterior;
        
        if (analise.p95 > CONFIG.timeoutRequisicao * 0.85) {
            const reducao = Math.ceil(concorrenciaAnterior * 0.3);
            novoValor = Math.max(
                concorrenciaAnterior - reducao,
                CONFIG.concorrenciaMinima
            );
            decisao = {
                acao: 'REDUÇÃO_CRÍTICA',
                razao: `P95 (${analise.p95}ms) muito próximo do timeout (${CONFIG.timeoutRequisicao}ms)`,
                reducao: reducao
            };
        }
        else if (analise.taxaTimeout > 5) {
            novoValor = Math.max(
                concorrenciaAnterior - 5,
                CONFIG.concorrenciaMinima
            );
            decisao = {
                acao: 'REDUÇÃO_POR_TIMEOUT',
                razao: `Taxa de timeout (${analise.taxaTimeout}%) acima de 5%`,
                reducao: 5
            };
        }
        else if (analise.p95 > CONFIG.timeoutRequisicao * 0.6 && tendencia === 'crescente') {
            novoValor = Math.max(
                concorrenciaAnterior - 3,
                CONFIG.concorrenciaMinima
            );
            decisao = {
                acao: 'REDUÇÃO_PREVENTIVA',
                razao: `P95 (${analise.p95}ms) alto e latência crescente`,
                reducao: 3
            };
        }
        else if (analise.taxaTimeout > 2) {
            novoValor = Math.max(
                concorrenciaAnterior - 2,
                CONFIG.concorrenciaMinima
            );
            decisao = {
                acao: 'REDUÇÃO_MODERADA',
                razao: `Taxa de timeout moderada (${analise.taxaTimeout}%)`,
                reducao: 2
            };
        }
        else if (
            analise.p95 < CONFIG.timeoutRequisicao * 0.3 &&
            analise.taxaTimeout < 0.5 &&
            tendencia !== 'crescente' &&
            concorrenciaAnterior < CONFIG.concorrenciaMaxima
        ) {
            novoValor = Math.min(
                concorrenciaAnterior + 5,
                CONFIG.concorrenciaMaxima
            );
            decisao = {
                acao: 'AUMENTO_SEGURO',
                razao: `P95 baixo (${analise.p95}ms), servidor respondendo rápido`,
                aumento: 5
            };
        }
        else if (
            analise.p95 < CONFIG.timeoutRequisicao * 0.5 &&
            analise.taxaTimeout < 1 &&
            tendencia === 'decrescente' &&
            concorrenciaAnterior < CONFIG.concorrenciaMaxima
        ) {
            novoValor = Math.min(
                concorrenciaAnterior + 3,
                CONFIG.concorrenciaMaxima
            );
            decisao = {
                acao: 'AUMENTO_CONSERVADOR',
                razao: `Latência decrescente, performance boa`,
                aumento: 3
            };
        }
        else {
            decisao = {
                acao: 'MANTER',
                razao: `Ponto de equilíbrio (P95: ${analise.p95}ms, Timeout: ${analise.taxaTimeout}%)`,
            };
        }
        
        if (novoValor !== concorrenciaAnterior) {
            estado.concorrenciaAtual = novoValor;
            
            estado.ajustesHistorico.push({
                timestamp: Date.now(),
                de: concorrenciaAnterior,
                para: novoValor,
                decisao: decisao,
                analise: analise
            });
            
            if (CONFIG.logDetalhado) {
                console.log('');
                console.log(`🔄 DECISÃO: ${decisao.acao}`);
                console.log(`📝 Razão: ${decisao.razao}`);
                console.log(`⚙️  Workers: ${concorrenciaAnterior} → ${novoValor}`);
                console.log('═══════════════════════════════════════════════════════════');
                console.log('');
            } else {
                console.log(`🔄 ${decisao.acao}: ${concorrenciaAnterior} → ${novoValor} workers`);
            }
        } else {
            if (CONFIG.logDetalhado) {
                console.log(`✅ DECISÃO: ${decisao.acao}`);
                console.log(`📝 Razão: ${decisao.razao}`);
                console.log('═══════════════════════════════════════════════════════════');
                console.log('');
            }
        }
        
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
            '⚠️ Confirma cancelar o processamento?\n\n' +
            'Os registros já enviados com sucesso não serão revertidos.\n' +
            'O checkpoint PERMANENTE será mantido.\n' +
            'Você pode continuar em outra execução.\n\n' +
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

        if (estado.concorrenciaAtual < min) {
            estado.concorrenciaAtual = min;
        }
        if (estado.concorrenciaAtual > max) {
            estado.concorrenciaAtual = max;
        }

        console.log(`⚙️ Limites atualizados: ${min} - ${max}`);
        console.log(`⚡ Workers atual: ${estado.concorrenciaAtual}`);

        alert(`✅ Limites aplicados!\n\nMín: ${min}\nMáx: ${max}\nAtual: ${estado.concorrenciaAtual}`);
        atualizarModal();
    };

    async function iniciarReenvioAPI() {
        if (estado.processando) {
            alert('⚠️ Já existe um processamento em andamento!');
            return;
        }

        if (!TOKEN_GLOBAL) {
            const tentarManual = confirm(
                '⚠️ TOKEN NÃO DETECTADO\n\n' +
                'Deseja fornecê-lo manualmente?'
            );

            if (tentarManual) {
                if (!solicitarTokenManual()) {
                    alert('❌ Token necessário!');
                    return;
                }
            } else {
                alert('❌ Token necessário!\n\nDica: Faça uma pesquisa no sistema.');
                return;
            }
        }

        const resumo = checkpointManager.getResumo();
        let mensagemInicial = '🚀 Iniciar reenvio via API?\n\n';

        if (resumo && resumo.idsSucesso > 0) {
            mensagemInicial +=
                `💾 CHECKPOINT ATIVO:\n` +
                `   • ${resumo.idsSucesso} IDs já tiveram SUCESSO\n` +
                `   • Esses IDs serão PULADOS automaticamente\n` +
                `   • Apenas registros sem sucesso serão processados\n\n`;
        }

        const statusTexto = CONFIG.statusBuscar === 'ERROR' ? 'apenas ERROR' :
                           CONFIG.statusBuscar === 'PENDING' ? 'apenas PENDING' :
                           'ERROR + PENDING';

        mensagemInicial +=
            `⚙️ CONFIGURAÇÕES:\n` +
            `   • Status: ${statusTexto}\n` +
            `   • Pool de Workers: ${CONFIG.concorrenciaInicial} → ${CONFIG.concorrenciaMaxima}\n` +
            `   • Auto-tuning Inteligente: ${CONFIG.ajusteAutomatico ? 'ATIVO' : 'DESATIVADO'}\n` +
            `   • Retry: ${CONFIG.maxRetentativas}x\n` +
            `   • Checkpoint: ${CONFIG.habilitarCheckpoint ? 'ATIVO (permanente)' : 'DESATIVADO'}\n`;

        if (CONFIG.habilitarFiltroData) {
            mensagemInicial +=
                `   • Filtro de Período: ${CONFIG.dataInicio} até ${CONFIG.dataFim}\n`;
        } else {
            mensagemInicial += `   • Filtro de Período: DESATIVADO (todos)\n`;
        }
        mensagemInicial += '\n';

        if (resumo && resumo.totalExecucoes > 0) {
            mensagemInicial += `📊 Execuções anteriores: ${resumo.totalExecucoes}\n\n`;
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
            resultados: [],
            workersAtivos: 0,
            metricsWorkers: {},
            metricsLatencia: {
                historico: [],
                p50: 0,
                p95: 0,
                p99: 0,
                media: 0,
                porConcorrencia: {}
            },
            ajustesHistorico: []
        };

        criarModal();
        console.log(`🚀 Iniciando reenvio via API Direct v${VERSAO}...`);
        console.log(`🏊 Pool de Workers Dinâmico habilitado`);
        console.log(`✨ Auto-tuning inteligente com análise de latência`);
        console.log(`📋 Status a buscar: ${statusTexto}`);
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
                let msg = '⚠️ Não há registros para processar!';
                msg += `\n\nStatus configurado: ${statusTexto}`;
                if (CONFIG.habilitarFiltroData) {
                    msg += `\nPeríodo: ${CONFIG.dataInicio} até ${CONFIG.dataFim}`;
                }
                msg += '\n\nDica: Verifique as configurações de status e período.';
                alert(msg);
                fecharModal();
                estado.processando = false;
                return;
            }

            console.log(`📊 Total a processar: ${estado.totalBuscados} registros`);

            if (resumo && resumo.idsSucesso > 0) {
                console.log(`💾 Checkpoint removerá parte do trabalho caso os IDs coincidam com sucesso prévio.`);
            }

            atualizarModal('Processando com pool de workers...');

            const resultados = await processarComPool(estado.registros);
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
        const analise = analisarPerformance();

        const statusTexto = CONFIG.statusBuscar === 'ERROR' ? 'ERROR' :
                           CONFIG.statusBuscar === 'PENDING' ? 'PENDING' :
                           'ERROR + PENDING';

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
        console.log(`    📋 Status buscados: ${statusTexto}`);
        
        if (analise) {
            console.log('');
            console.log('  MÉTRICAS DE LATÊNCIA:');
            console.log(`    📊 P50: ${analise.p50}ms | P95: ${analise.p95}ms | P99: ${analise.p99}ms`);
            console.log(`    ⚡ Throughput final: ${analise.throughputTeorico} req/s`);
        }
        
        console.log('');
        console.log('  CHECKPOINT PERMANENTE:');
        console.log(`    💾 Total IDs com sucesso: ${resumo.idsSucesso}`);
        console.log(`    📊 Total execuções: ${resumo.totalExecucoes}`);
        
        if (estado.ajustesHistorico.length > 0) {
            console.log('');
            console.log('  AUTO-TUNING:');
            console.log(`    🔄 Total de ajustes: ${estado.ajustesHistorico.length}`);
        }
        
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
                ? `⚠️ PROCESSAMENTO CANCELADO\n\n`
                : `🎊 REENVIO FINALIZADO!\n\n`;

            let textoCompleto = mensagem +
                `ESTA EXECUÇÃO:\n` +
                `  ✅ Sucesso: ${estado.totalSucesso}\n` +
                `  ❌ Erros: ${estado.totalErro}\n` +
                `  ⏱️ Timeouts: ${estado.totalTimeout}\n`;

            if (estado.totalPulados > 0) {
                textoCompleto += `  ⏭️ Pulados: ${estado.totalPulados}\n`;
            }

            textoCompleto +=
                `  ⚡ Velocidade: ${velocidade} reg/min\n` +
                `  📋 Status: ${statusTexto}\n`;
                
            if (analise) {
                textoCompleto += `  📊 P95 final: ${analise.p95}ms\n`;
            }
            
            textoCompleto +=
                `\nCHECKPOINT PERMANENTE:\n` +
                `  💾 Total com sucesso: ${resumo.idsSucesso}\n` +
                `  📊 Total execuções: ${resumo.totalExecucoes}\n`;

            if (CONFIG.habilitarFiltroData) {
                textoCompleto += `\nPERÍODO FILTRADO:\n` +
                                `  📅 ${CONFIG.dataInicio} até ${CONFIG.dataFim}\n`;
            }

            textoCompleto += `\nExportar relatório CSV?`;

            const confirmExport = confirm(textoCompleto);

            if (confirmExport) {
                exportarCSV();
            }

            fecharModal();
            estado.processando = false;
        }, 500);
    }

    // ============================================
    // 🎨 INTERFACE COM MÉTRICAS AVANÇADAS
    // ============================================

    function criarModal() {
        if (document.getElementById('apiDirectModal')) return;

        const modal = document.createElement('div');
        modal.id = 'apiDirectModal';
        modal.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(0,0,0,0.7); z-index: 999999; display: flex;
                        align-items: center; justify-content: center; overflow-y: auto;">
                <div style="background: white; padding: 30px; border-radius: 8px;
                            min-width: 650px; max-width: 850px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                            margin: 20px;">
                    <h2 style="margin: 0 0 20px 0; color: #00bcd4; text-align: center;">
                        🚀 API Direct v${VERSAO}
                    </h2>

                    <div id="apiStatus" style="font-size: 14px; color: #666; margin-bottom: 15px; text-align: center; font-weight: bold;">
                        Iniciando...
                    </div>

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

                    <!-- ✨ NOVO: Métricas de Latência -->
                    <div style="background: #fff3e0; padding: 15px; border-radius: 4px; margin-bottom: 20px; border-left: 4px solid #ff9800;">
                        <div style="font-weight: bold; margin-bottom: 10px; color: #e65100;">
                            📊 Métricas de Latência (últimas 100 req)
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 12px;">
                            <div>
                                <strong>P50:</strong>
                                <span id="apiP50" style="float: right; font-weight: bold; color: #2196f3;">-</span>
                            </div>
                            <div>
                                <strong>P95:</strong>
                                <span id="apiP95" style="float: right; font-weight: bold; color: #ff9800;">-</span>
                            </div>
                            <div>
                                <strong>P99:</strong>
                                <span id="apiP99" style="float: right; font-weight: bold; color: #f44336;">-</span>
                            </div>
                            <div>
                                <strong>Média:</strong>
                                <span id="apiMedia" style="float: right; font-weight: bold;">-</span>
                            </div>
                            <div>
                                <strong>Throughput:</strong>
                                <span id="apiThroughput" style="float: right; font-weight: bold; color: #4caf50;">-</span>
                            </div>
                            <div>
                                <strong>Tendência:</strong>
                                <span id="apiTendencia" style="float: right; font-weight: bold;">-</span>
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

        const analise = analisarPerformance();
        const tendencia = detectarTendenciaLatencia();
        
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
            apiTaxaSucesso: `${taxaSucesso}%`,
            apiP50: analise ? `${analise.p50}ms` : '-',
            apiP95: analise ? `${analise.p95}ms` : '-',
            apiP99: analise ? `${analise.p99}ms` : '-',
            apiMedia: analise ? `${analise.media}ms` : '-',
            apiThroughput: analise ? `${analise.throughputTeorico} req/s` : '-',
            apiTendencia: tendencia === 'crescente' ? '📈' : 
                         tendencia === 'decrescente' ? '📉' : '➡️'
        };

        Object.entries(elementos).forEach(([id, valor]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = valor;
        });

        const p95El = document.getElementById('apiP95');
        if (p95El && analise) {
            const ratio = analise.p95 / CONFIG.timeoutRequisicao;
            if (ratio > 0.8) {
                p95El.style.color = '#f44336';
            } else if (ratio > 0.5) {
                p95El.style.color = '#ff9800';
            } else {
                p95El.style.color = '#4caf50';
            }
        }

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
            ['ID', 'CPF', 'Vacina', 'Status', 'HTTP Status', 'Tentativa', 'Latência (ms)', 'Erro', 'Timestamp'].join(';')
        ];

        estado.resultados.forEach(r => {
            linhas.push([
                r.id,
                r.cpf,
                r.vacina,
                r.status,
                r.statusCode,
                r.tentativa,
                r.latencia || '-',
                (r.erro || '').replace(/;/g, ','),
                r.timestamp
            ].join(';'));
        });

        const resumo = checkpointManager.getResumo();
        const analise = analisarPerformance();

        const statusTexto = CONFIG.statusBuscar === 'ERROR' ? 'ERROR' :
                           CONFIG.statusBuscar === 'PENDING' ? 'PENDING' :
                           'ERROR + PENDING';
                           
        const taxaSucesso = estado.totalProcessados > 0 
            ? ((estado.totalSucesso / estado.totalProcessados) * 100).toFixed(1) 
            : 0;

        linhas.push('');
        linhas.push('ESTATÍSTICAS DESTA EXECUÇÃO');
        linhas.push(`Status Buscados;${statusTexto}`);
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
        linhas.push(`Taxa Sucesso;${taxaSucesso}%`);

        if (analise) {
            linhas.push('');
            linhas.push('MÉTRICAS DE LATÊNCIA');
            linhas.push(`P50;${analise.p50}ms`);
            linhas.push(`P95;${analise.p95}ms`);
            linhas.push(`P99;${analise.p99}ms`);
            linhas.push(`Média;${analise.media}ms`);
            linhas.push(`Throughput;${analise.throughputTeorico} req/s`);
        }

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
        const objectUrl = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `reenvio_api_v${VERSAO}_${new Date().toISOString().split('T')[0]}.csv`;
        link.id = 'exportarCSVBtn';
        link.click();

        setTimeout(() => URL.revokeObjectURL(objectUrl), 200);

        console.log('💾 CSV exportado!');
    }

    // ============================================
    // ⚙️ CONFIGURAÇÕES
    // ============================================

    function abrirConfiguracoes() {
        const modalConfig = document.createElement('div');
        modalConfig.id = 'modalConfiguracoes';
        
        const errorChecked = CONFIG.statusBuscar === 'ERROR' ? 'checked' : '';
        const pendingChecked = CONFIG.statusBuscar === 'PENDING' ? 'checked' : '';
        const ambosChecked = CONFIG.statusBuscar === 'AMBOS' ? 'checked' : '';
        
        modalConfig.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(0,0,0,0.7); z-index: 999999; display: flex;
                        align-items: center; justify-content: center;">
                <div style="background: white; padding: 30px; border-radius: 8px;
                            width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <h2 style="margin: 0 0 20px 0; color: #00bcd4;">⚙️ Configurações</h2>

                    <div style="margin-bottom: 20px; background: #e8f5e9; padding: 15px; border-radius: 4px; border: 2px solid #4caf50;">
                        <label style="display: block; margin-bottom: 10px; font-weight: bold; font-size: 16px; color: #2e7d32;">
                            📋 Status dos Registros a Buscar
                        </label>
                        <div style="margin-bottom: 10px;">
                            <label style="display: flex; align-items: center; cursor: pointer; padding: 8px; background: white; border-radius: 4px; margin-bottom: 8px;">
                                <input type="radio" name="statusBuscar" value="ERROR" ${errorChecked}
                                       style="margin-right: 10px; width: 18px; height: 18px; cursor: pointer;">
                                <div>
                                    <strong>❌ Apenas ERROR</strong>
                                    <div style="font-size: 12px; color: #666; margin-top: 2px;">
                                        Busca somente registros com erro no envio
                                    </div>
                                </div>
                            </label>
                            <label style="display: flex; align-items: center; cursor: pointer; padding: 8px; background: white; border-radius: 4px; margin-bottom: 8px;">
                                <input type="radio" name="statusBuscar" value="PENDING" ${pendingChecked}
                                       style="margin-right: 10px; width: 18px; height: 18px; cursor: pointer;">
                                <div>
                                    <strong>⏳ Apenas PENDING</strong>
                                    <div style="font-size: 12px; color: #666; margin-top: 2px;">
                                        Busca somente registros pendentes de envio
                                    </div>
                                </div>
                            </label>
                            <label style="display: flex; align-items: center; cursor: pointer; padding: 8px; background: white; border-radius: 4px;">
                                <input type="radio" name="statusBuscar" value="AMBOS" ${ambosChecked}
                                       style="margin-right: 10px; width: 18px; height: 18px; cursor: pointer;">
                                <div>
                                    <strong>📋 AMBOS (ERROR + PENDING)</strong>
                                    <div style="font-size: 12px; color: #666; margin-top: 2px;">
                                        Busca registros com erro E pendentes (recomendado)
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>

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

            const statusSelecionado = document.querySelector('input[name="statusBuscar"]:checked');
            if (statusSelecionado) {
                CONFIG.statusBuscar = statusSelecionado.value;
            }

            if (CONFIG.timeoutRequisicao < 5000) {
                alert('⚠️ Timeout muito baixo! Mínimo recomendado: 5000ms (5s)');
                return;
            }

            if (CONFIG.timeoutRequisicao > 120000) {
                if (!confirm(
                    '⚠️ Timeout muito alto!\n\n' +
                    `Timeout configurado: ${CONFIG.timeoutRequisicao}ms (${CONFIG.timeoutRequisicao/1000}s)\n\n` +
                    'Timeouts altos podem travar o processamento se houver problemas na rede.\n\n' +
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
                        '⚠️ Data de fim está no futuro!\n\n' +
                        `Data fim: ${CONFIG.dataFim}\n` +
                        `Hoje: ${hoje.toISOString().split('T')[0]}\n\n` +
                        'Continuar mesmo assim?'
                    )) {
                        return;
                    }
                }
            }

            localStorage.setItem('RNDS_CONFIG', JSON.stringify(CONFIG));

            const statusTexto = CONFIG.statusBuscar === 'ERROR' ? 'apenas ERROR' :
                               CONFIG.statusBuscar === 'PENDING' ? 'apenas PENDING' :
                               'ERROR + PENDING (ambos)';

            let msg = '✅ Configurações salvas!\n\n';
            msg += `📋 Status: ${statusTexto}\n`;
            msg += `⏱️ Timeout: ${CONFIG.timeoutRequisicao}ms (${CONFIG.timeoutRequisicao/1000}s)\n`;
            
            if (CONFIG.habilitarFiltroData) {
                msg += `\n📅 Filtro de período ATIVO:\n${CONFIG.dataInicio} até ${CONFIG.dataFim}`;
            } else {
                msg += '\n📅 Filtro de período DESATIVADO (buscará todos os registros)';
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
        let mensagem = '💾 CHECKPOINT PERMANENTE\n\n' +
                      `Data: ${resumo.dataCheckpoint.toLocaleString()}\n` +
                      `IDs com SUCESSO: ${resumo.idsSucesso}\n` +
                      `Execuções: ${resumo.totalExecucoes}\n\n`;

        if (historico.length > 0) {
            mensagem += 'HISTÓRICO:\n';
            historico.slice(-5).forEach(h => {
                mensagem += `  ${h.numero}. ${h.data} - ${h.sucessos} sucessos\n`;
            });
            mensagem += '\n';
        }

        mensagem +=
            '✅ IDs com sucesso são PERMANENTES\n' +
            '✅ Serão pulados em TODAS as execuções\n' +
            '🔄 Erros/timeouts tentados novamente\n\n' +
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
                const copiar = confirm(`🔑 TOKEN:\n\n${TOKEN_GLOBAL}\n\n\nCopiar?`);
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
        console.log(`🚀 SPRNDS - API Direct v${VERSAO}`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✨ NOVO NA v13.4.8:');
        console.log('  • Correção de await dos workers em processarComPool');
        console.log('  • Utilização de Promise.allSettled()');
        console.log('  • try/catch fatal nos workers para garantir sync de estado');
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

        const statusTexto = CONFIG.statusBuscar === 'ERROR' ? 'apenas ERROR' :
                           CONFIG.statusBuscar === 'PENDING' ? 'apenas PENDING' :
                           'ERROR + PENDING';
        console.log(`📋 Status configurado: ${statusTexto}`);

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

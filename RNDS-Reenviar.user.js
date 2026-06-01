// ==UserScript==
// @name         SPRNDS - Reenviar v13.5.6
// @namespace    http://tampermonkey.net/
// @version      13.5.7
// @description  Auto-tuning inteligente + classificação avançada + proteção Java heap + relogin automático + relatório com nome/CNS + caixas internas sem alert/confirm/prompt
// @author       Renato Krebs Rosa
// @match        *://*/rnds/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @supportURL   https://github.com/RenatoKR/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';

    const VERSAO = '13.5.7';

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
        statusBuscar: 'AMBOS', // 'ERROR', 'PENDING', 'AMBOS'
        // Proteção de backend: respostas como java.lang.OutOfMemoryError / Java heap space
        fatorReducaoOutOfMemory: 0.25, // ao detectar heap, reduz para 25% dos workers atuais
        fatorReducaoErroServidor: 0.50, // em onda de 5xx/429, reduz para 50% dos workers atuais
        cooldownOutOfMemoryMs: 30000,
        cooldownErroServidorMs: 10000,
        janelaReducaoCriticaMs: 10000,
        // Renovação de sessão: usa o fluxo implicit OAuth observado no SIGSS/RNDS.
        // O HAR mostra /rnds/api/oauth2/implicit → /mvsso/oauth2.0/authorize → /rnds#access_token=...
        habilitarReloginAutomatico: true,
        oauthImplicitUrl: '/rnds/api/oauth2/implicit',
        tempoMaximoReloginMs: 20000,
        maxTentativasRelogin: 2,
        cooldownReloginMs: 5000,
        renovarTokenPreventivamente: true,
        intervaloWatchdogSessaoMs: 5 * 60 * 1000,
        renovarTokenACadaMs: 30 * 60 * 1000,
        renovarSeTokenExpiraEmMs: 15 * 60 * 1000,
        maxFalhasReloginConsecutivas: 2,
        pausarAoFalharRelogin: true,
        permitirFallbackIframeRelogin: false, // iframe é bloqueado por X-Frame-Options em alguns ambientes
        // Relogin com credenciais: credenciais ficam SOMENTE em memória, nunca no localStorage/checkpoint/CSV.
        habilitarLoginAutomaticoComCredenciais: true,
        solicitarCredenciaisNoInicio: true,
        abrirPopupReloginAntecipado: true,
        tempoMaximoLoginCredenciaisMs: 90000,
        maxSubmissoesFormularioLogin: 3,
        preservarCredenciaisAposFim: false,
        // Hysteresis/recuperação pós-heap: evita efeito sanfona 1 → 30 → heap → 1.
        recuperacaoBackendMs: 5 * 60 * 1000,
        incrementoRecuperacaoBackend: 1,
        minimoSucessosParaSubirPosHeap: 30,
        p95MaximoRatioRecuperacao: 0.40,
        taxaTimeoutMaximaRecuperacao: 0.5,
        // Checkpoint de concorrência segura: grava workers somente após janela estável.
        usarWorkersSeguroCheckpoint: true,
        minimoAmostrasWorkersSeguro: 30,
        minimoSucessosWorkersSeguro: 30,
        maxFalhasCriticasWorkersSeguro: 0,
        maxHistoricoWorkersSeguro: 20,
        hysteresisPosHeapMs: 30 * 60 * 1000,
        incrementoMaximoNormalPosHeap: 1,
        limitarAumentoAoWorkersSeguroPosHeap: true,
        margemWorkersSobreSeguroPosHeap: 1,
        // Interface interna: evita alert/confirm/prompt nativos bloqueados em aba em segundo plano.
        usarDialogsNativos: false,
        exportarCSVAutomaticamente: true,
        manterModalAbertoAoFinal: true,
        maxMensagensInterface: 12
    };

    // ============================================
    // 💾 GERENCIADOR DE CHECKPOINT PERMANENTE
    // ============================================

    class CheckpointManager {
        constructor() {
            this.STORAGE_KEY = 'RNDS_CHECKPOINT';
            this.checkpoint = this.carregar() || this.criar();
            this.checkpoint = this.normalizar(this.checkpoint);
            this.idsSet = new Set(this.checkpoint.idsSucesso);
        }

        normalizar(checkpoint) {
            checkpoint.idsSucesso = checkpoint.idsSucesso || [];
            checkpoint.estatisticas = checkpoint.estatisticas || {
                totalSucesso: 0,
                totalErro: 0,
                totalTimeout: 0,
                totalRetentativas: 0
            };
            checkpoint.execucoes = checkpoint.execucoes || [];
            checkpoint.workersSeguro = checkpoint.workersSeguro || {
                valor: null,
                atualizadoEm: null,
                evidencias: null,
                historico: []
            };
            checkpoint.workersSeguro.historico = checkpoint.workersSeguro.historico || [];
            checkpoint.backendFragil = checkpoint.backendFragil || {
                ultimoHeapEm: null,
                ultimoWorkersComHeap: null,
                tetoRecuperacao: null,
                workersDepoisReducao: null
            };
            return checkpoint;
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
                workersSeguro: {
                    valor: null,
                    atualizadoEm: null,
                    evidencias: null,
                    historico: []
                },
                backendFragil: {
                    ultimoHeapEm: null,
                    ultimoWorkersComHeap: null,
                    tetoRecuperacao: null,
                    workersDepoisReducao: null
                },
                versao: VERSAO,
                execucoes: []
            };
        }

        carregar() {
            try {
                const dados = localStorage.getItem(this.STORAGE_KEY);
                if (dados) {
                    const checkpoint = this.normalizar(JSON.parse(dados));
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
                },
                workers: {
                    inicial: estado?.concorrenciaAtual || CONFIG.concorrenciaInicial,
                    seguroInicialCheckpoint: this.getWorkersSeguro()?.valor || null,
                    ajustes: []
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

        getWorkersSeguro() {
            if (!this.checkpoint || !this.checkpoint.workersSeguro || !this.checkpoint.workersSeguro.valor) return null;
            return this.checkpoint.workersSeguro;
        }

        registrarWorkersSeguro(workers, evidencias = {}) {
            if (!this.checkpoint || !CONFIG.habilitarCheckpoint || !CONFIG.usarWorkersSeguroCheckpoint) return;

            const valor = Math.max(CONFIG.concorrenciaMinima, Math.min(CONFIG.concorrenciaMaxima, parseInt(workers, 10) || CONFIG.concorrenciaMinima));
            const atual = this.checkpoint.workersSeguro?.valor || null;
            const agora = Date.now();

            this.checkpoint.workersSeguro = this.checkpoint.workersSeguro || { valor: null, atualizadoEm: null, evidencias: null, historico: [] };
            this.checkpoint.workersSeguro.historico = this.checkpoint.workersSeguro.historico || [];

            if (atual === valor && this.checkpoint.workersSeguro.evidencias?.execucaoId === evidencias.execucaoId) {
                return;
            }

            this.checkpoint.workersSeguro.valor = valor;
            this.checkpoint.workersSeguro.atualizadoEm = agora;
            this.checkpoint.workersSeguro.evidencias = {
                ...evidencias,
                atualizadoEm: new Date(agora).toISOString()
            };
            this.checkpoint.workersSeguro.historico.push({
                valor,
                atualizadoEm: agora,
                evidencias: this.checkpoint.workersSeguro.evidencias
            });

            if (this.checkpoint.workersSeguro.historico.length > CONFIG.maxHistoricoWorkersSeguro) {
                this.checkpoint.workersSeguro.historico = this.checkpoint.workersSeguro.historico.slice(-CONFIG.maxHistoricoWorkersSeguro);
            }

            if (this.execucaoAtual) {
                this.execucaoAtual.workers = this.execucaoAtual.workers || { ajustes: [] };
                this.execucaoAtual.workers.ultimoSeguroRegistrado = valor;
            }

            console.log(`💾 Workers seguro atualizado no checkpoint: ${valor}`);
            this.salvar();
        }

        registrarAjusteWorkers(ajuste) {
            if (!this.execucaoAtual) return;
            this.execucaoAtual.workers = this.execucaoAtual.workers || { ajustes: [] };
            this.execucaoAtual.workers.ajustes = this.execucaoAtual.workers.ajustes || [];
            this.execucaoAtual.workers.ajustes.push(ajuste);
        }

        registrarHeapBackend(workersComHeap, workersDepoisReducao, tetoRecuperacao) {
            if (!this.checkpoint || !CONFIG.habilitarCheckpoint) return;
            const agora = Date.now();
            this.checkpoint.backendFragil = this.checkpoint.backendFragil || {};
            this.checkpoint.backendFragil.ultimoHeapEm = agora;
            this.checkpoint.backendFragil.ultimoWorkersComHeap = workersComHeap;
            this.checkpoint.backendFragil.workersDepoisReducao = workersDepoisReducao;
            this.checkpoint.backendFragil.tetoRecuperacao = tetoRecuperacao;
            this.checkpoint.backendFragil.recuperacaoAte = agora + CONFIG.recuperacaoBackendMs;
            this.salvar();
        }

        encerrarFragilidadeBackend() {
            if (!this.checkpoint || !this.checkpoint.backendFragil) return;
            this.checkpoint.backendFragil.recuperacaoAte = null;
            this.salvar();
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

        async limpar() {
            const confirmarLimpeza = await appConfirm(
                '⚠️ ATENÇÃO: LIMPAR CHECKPOINT PERMANENTE\n\n' +
                `Você tem ${this.checkpoint.idsSucesso.length} IDs com sucesso salvos.\n\n` +
                'Ao limpar, TODOS os sucessos anteriores serão perdidos!\n' +
                'Todos os registros serão processados novamente do zero.\n\n' +
                'Tem certeza que deseja LIMPAR?',
                'Limpar checkpoint permanente',
                'alerta',
                'Limpar checkpoint',
                'Cancelar'
            );
            if (confirmarLimpeza) {
                localStorage.removeItem(this.STORAGE_KEY);
                this.checkpoint = this.criar();
                this.idsSet = new Set();
                console.log('🗑️ Checkpoint limpo - todos os IDs serão reprocessados');
                await appAlert('✅ Checkpoint limpo com sucesso!\n\nNa próxima execução, todos os registros serão processados.', 'Checkpoint limpo', 'ok');
            }
        }

        getResumo() {
            if (!this.checkpoint) return null;

            return {
                dataCheckpoint: new Date(this.checkpoint.timestamp),
                idsSucesso: this.checkpoint.idsSucesso.length,
                estatisticas: this.checkpoint.estatisticas,
                totalExecucoes: this.checkpoint.execucoes?.length || 0,
                workersSeguro: this.checkpoint.workersSeguro || null,
                backendFragil: this.checkpoint.backendFragil || null
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
    // 📊 RESUMO DETALHADO DE RESULTADOS
    // ============================================

    function criarResumoStatusDetalhado() {
        return {
            sucessoConfirmado: 0,
            jaExistia: 0,
            aceitoPendente: 0,
            indeterminado: 0,
            erroValidacao: 0,
            erroNegocio: 0,
            conflito: 0,
            naoEncontrado: 0,
            erroAuth: 0,
            sessaoExpirada: 0,
            reloginSucesso: 0,
            reloginFalha: 0,
            renovacaoPreventiva: 0,
            reloginBloqueado: 0,
            rateLimit: 0,
            javaOutOfMemory: 0,
            erroServidor: 0,
            erroRede: 0,
            erroHttp: 0,
            timeout: 0
        };
    }

    function statusContaComoSucesso(status) {
        return ['SUCESSO', 'SUCESSO_CONFIRMADO', 'JA_EXISTIA'].includes(status);
    }

    function statusContaComoTimeout(status) {
        return status === 'TIMEOUT';
    }

    function incrementarResumoStatus(resultado) {
        if (!estado.statusDetalhado) {
            estado.statusDetalhado = criarResumoStatusDetalhado();
        }

        const mapa = {
            SUCESSO: 'sucessoConfirmado',
            SUCESSO_CONFIRMADO: 'sucessoConfirmado',
            JA_EXISTIA: 'jaExistia',
            ACEITO_PENDENTE: 'aceitoPendente',
            HTTP_OK_INDETERMINADO: 'indeterminado',
            ERRO_VALIDACAO: 'erroValidacao',
            ERRO_NEGOCIO: 'erroNegocio',
            CONFLITO: 'conflito',
            NAO_ENCONTRADO: 'naoEncontrado',
            ERRO_AUTH: 'erroAuth',
            ERRO_SESSAO_EXPIRADA: 'sessaoExpirada',
            RATE_LIMIT: 'rateLimit',
            ERRO_SERVIDOR_JAVA_HEAP: 'javaOutOfMemory',
            ERRO_SERVIDOR: 'erroServidor',
            ERRO_REDE: 'erroRede',
            ERRO_HTTP: 'erroHttp',
            TIMEOUT: 'timeout'
        };

        const chave = mapa[resultado.status] || 'indeterminado';
        estado.statusDetalhado[chave] = (estado.statusDetalhado[chave] || 0) + 1;
    }

    // ============================================
    // 📊 ESTADO GLOBAL
    // ============================================

    function limitarWorkers(valor) {
        const numero = parseInt(valor, 10);
        if (!Number.isFinite(numero) || numero <= 0) return CONFIG.concorrenciaInicial;
        return Math.max(CONFIG.concorrenciaMinima, Math.min(CONFIG.concorrenciaMaxima, numero));
    }

    function obterConcorrenciaInicialEfetiva() {
        const seguro = CONFIG.usarWorkersSeguroCheckpoint ? checkpointManager.getWorkersSeguro() : null;
        const backendFragil = checkpointManager.getResumo()?.backendFragil || null;
        let inicial = CONFIG.concorrenciaInicial;

        if (seguro?.valor) {
            inicial = Math.min(inicial, seguro.valor);
        }

        if (backendFragil?.recuperacaoAte && Date.now() < backendFragil.recuperacaoAte) {
            const teto = backendFragil.tetoRecuperacao || backendFragil.workersDepoisReducao;
            if (teto) inicial = Math.min(inicial, teto);
        }

        return limitarWorkers(inicial);
    }

    function criarEstadoInicial(concorrenciaInicialEfetiva = CONFIG.concorrenciaInicial) {
        const seguroCheckpoint = checkpointManager.getWorkersSeguro();
        const backendFragil = checkpointManager.getResumo()?.backendFragil || null;
        const emRecuperacaoPersistida = !!(backendFragil?.recuperacaoAte && Date.now() < backendFragil.recuperacaoAte);

        return {
            processando: false,
            pausado: false,
            cancelado: false,
            iniciado: null,
            concorrenciaAtual: limitarWorkers(concorrenciaInicialEfetiva),
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
            ajustesHistorico: [],
            cooldownAte: 0,
            ultimaReducaoCriticaBackend: 0,
            totalOutOfMemory: 0,
            totalSessaoExpirada: 0,
            totalReloginSucesso: 0,
            totalReloginFalha: 0,
            relogando: false,
            ultimoRelogin: 0,
            falhasReloginConsecutivas: 0,
            sessaoBloqueada: false,
            ultimaRenovacaoPreventiva: 0,
            modoRecuperacaoBackend: emRecuperacaoPersistida,
            backendFragilAte: emRecuperacaoPersistida ? backendFragil.recuperacaoAte : 0,
            tetoRecuperacaoBackend: emRecuperacaoPersistida ? (backendFragil.tetoRecuperacao || backendFragil.workersDepoisReducao || null) : null,
            sucessosDesdeHeap: 0,
            ultimoWorkersComHeap: backendFragil?.ultimoWorkersComHeap || null,
            ultimoHeapEm: backendFragil?.ultimoHeapEm || 0,
            workersSeguroCheckpointInicial: seguroCheckpoint?.valor || null,
            concorrenciaAmostrada: limitarWorkers(concorrenciaInicialEfetiva),
            amostrasNaConcorrenciaAtual: 0,
            sucessosNaConcorrenciaAtual: 0,
            falhasCriticasNaConcorrenciaAtual: 0,
            ultimoWorkersSeguroRegistrado: seguroCheckpoint?.valor || null,
            statusDetalhado: criarResumoStatusDetalhado()
        };
    }

    let estado = criarEstadoInicial(obterConcorrenciaInicialEfetiva());

    let TOKEN_GLOBAL = null;
    let TOKEN_EXPIRA_EM = parseInt(localStorage.getItem('RNDS_TOKEN_EXPIRES_AT') || '0', 10) || 0;
    let TOKEN_CAPTURADO_EM = parseInt(localStorage.getItem('RNDS_TOKEN_CAPTURED_AT') || '0', 10) || 0;
    let reloginPromise = null;
    let watchdogSessaoTimer = null;
    let credenciaisLoginMemoria = null;
    let credenciaisLoginPromise = null;
    let popupReloginPreAberto = null;

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
                TOKEN_CAPTURADO_EM = Date.now();
                localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
                localStorage.setItem('RNDS_TOKEN_CAPTURED_AT', String(TOKEN_CAPTURADO_EM));
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
                        TOKEN_CAPTURADO_EM = Date.now();
                        localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
                        localStorage.setItem('RNDS_TOKEN_CAPTURED_AT', String(TOKEN_CAPTURADO_EM));
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
                    TOKEN_CAPTURADO_EM = Date.now();
                    localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
                    localStorage.setItem('RNDS_TOKEN_CAPTURED_AT', String(TOKEN_CAPTURADO_EM));
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
                TOKEN_EXPIRA_EM = parseInt(localStorage.getItem('RNDS_TOKEN_EXPIRES_AT') || '0', 10) || 0;
                TOKEN_CAPTURADO_EM = parseInt(localStorage.getItem('RNDS_TOKEN_CAPTURED_AT') || '0', 10) || Date.now();
                console.log(`🔑 Token encontrado em storage: ${chave}`);
                atualizarBotaoToken(true);
                return true;
            }
        }

        return false;
    }

    async function solicitarTokenManual() {
        const token = await appPrompt(
            '🔑 TOKEN NÃO DETECTADO\n\n' +
            'Passos:\n' +
            '1. F12 → Network\n' +
            '2. Faça uma pesquisa\n' +
            '3. Clique em "/api/vaccine-sync"\n' +
            '4. Copie o header "Authorization".',
            'Token manual',
            'Token Authorization/Bearer'
        );

        if (token) {
            TOKEN_GLOBAL = token.replace('Bearer ', '').trim();
            TOKEN_CAPTURADO_EM = Date.now();
            TOKEN_EXPIRA_EM = 0;
            localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
            localStorage.setItem('RNDS_TOKEN_CAPTURED_AT', String(TOKEN_CAPTURADO_EM));
            localStorage.removeItem('RNDS_TOKEN_EXPIRES_AT');
            console.log('🔑 Token fornecido manualmente!');
            atualizarBotaoToken(true);
            await appAlert('Token fornecido manualmente e salvo para esta sessão.', 'Token capturado', 'ok');
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


    function escaparHtml(valor) {
        return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatarMensagemHtml(mensagem) {
        return escaparHtml(mensagem).replace(/\n/g, '<br>');
    }

    function obterContainerMensagensInternas() {
        let container = document.getElementById('apiMensagensLista');
        if (container) return container;

        const modal = document.getElementById('apiDirectModal');
        if (modal) {
            let painel = document.getElementById('apiMensagensPainel');
            if (!painel) {
                painel = document.createElement('div');
                painel.id = 'apiMensagensPainel';
                painel.style.cssText = 'background:#f8fbff; border:1px solid #bbdefb; border-left:4px solid #2196f3; padding:12px; border-radius:6px; margin:14px 0; font-size:13px;';
                painel.innerHTML = '<div style="font-weight:bold; color:#1565c0; margin-bottom:8px;">📬 Mensagens / ações do script</div><div id="apiMensagensLista" style="display:flex; flex-direction:column; gap:8px; max-height:180px; overflow:auto;"></div>';
                const botoes = document.getElementById('apiBotoesControle') || document.getElementById('apiBotoesFinais');
                if (botoes && botoes.parentNode) botoes.parentNode.insertBefore(painel, botoes);
                else modal.querySelector('div div')?.appendChild(painel);
            }
            return document.getElementById('apiMensagensLista');
        }

        container = document.getElementById('sprndsMensagensFlutuantes');
        if (!container) {
            container = document.createElement('div');
            container.id = 'sprndsMensagensFlutuantes';
            container.style.cssText = 'position:fixed; right:16px; bottom:16px; width:380px; max-height:65vh; overflow:auto; z-index:1000002; font-family:Arial,sans-serif; display:flex; flex-direction:column; gap:8px;';
            document.body.appendChild(container);
        }
        return container;
    }

    function mostrarMensagemInterna(tipo, titulo, mensagem, opcoes = {}) {
        const container = obterContainerMensagensInternas();
        if (!container) return null;

        const cores = {
            ok: ['#2e7d32', '#e8f5e9'],
            erro: ['#c62828', '#ffebee'],
            alerta: ['#ef6c00', '#fff3e0'],
            info: ['#1565c0', '#e3f2fd']
        };
        const [cor, fundo] = cores[tipo] || cores.info;
        const item = document.createElement('div');
        item.style.cssText = `background:${fundo}; border-left:4px solid ${cor}; border-radius:5px; padding:10px; box-shadow:0 2px 8px rgba(0,0,0,.12); color:#222;`;
        item.innerHTML = `
            <div style="display:flex; gap:8px; align-items:flex-start; justify-content:space-between;">
                <div style="min-width:0; flex:1;">
                    <div style="font-weight:bold; color:${cor}; margin-bottom:3px;">${escaparHtml(titulo)}</div>
                    <div style="line-height:1.35; word-break:break-word;">${formatarMensagemHtml(mensagem)}</div>
                </div>
                <button type="button" data-fechar="1" title="Fechar" style="border:none; background:transparent; cursor:pointer; color:${cor}; font-weight:bold; font-size:16px; line-height:1;">×</button>
            </div>`;
        item.querySelector('[data-fechar="1"]').onclick = () => item.remove();
        container.appendChild(item);

        while (container.children.length > (CONFIG.maxMensagensInterface || 12)) {
            container.firstElementChild?.remove();
        }

        if (!opcoes.persistente) {
            setTimeout(() => {
                if (item.isConnected) item.remove();
            }, opcoes.tempoMs || 15000);
        }
        return item;
    }

    function mostrarDialogoInterno({ titulo, mensagem, tipo = 'info', confirmar = 'OK', cancelar = null, campo = null, valorInicial = '', senha = false }) {
        return new Promise((resolve) => {
            const existente = document.getElementById('sprndsDialogoInterno');
            if (existente) existente.remove();

            const cores = {
                ok: '#2e7d32', erro: '#c62828', alerta: '#ef6c00', info: '#1565c0'
            };
            const cor = cores[tipo] || cores.info;
            const overlay = document.createElement('div');
            overlay.id = 'sprndsDialogoInterno';
            overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:1000003; display:flex; align-items:center; justify-content:center; font-family:Arial,sans-serif;';
            overlay.innerHTML = `
                <div style="background:white; width:520px; max-width:calc(100vw - 30px); border-radius:8px; padding:22px; box-shadow:0 8px 30px rgba(0,0,0,.35);">
                    <h2 style="margin:0 0 12px 0; color:${cor}; font-size:20px;">${escaparHtml(titulo)}</h2>
                    <div style="font-size:13px; line-height:1.45; color:#333; margin-bottom:14px; max-height:45vh; overflow:auto; white-space:normal;">${formatarMensagemHtml(mensagem)}</div>
                    ${campo ? `<label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">${escaparHtml(campo)}</label><input id="sprndsDialogoCampo" type="${senha ? 'password' : 'text'}" value="${escaparHtml(valorInicial)}" style="width:100%; box-sizing:border-box; padding:10px; border:1px solid #bbb; border-radius:4px; margin-bottom:14px;" />` : ''}
                    <div style="display:flex; gap:10px; justify-content:flex-end;">
                        ${cancelar ? `<button id="sprndsDialogoCancelar" type="button" style="padding:9px 14px; border:none; border-radius:4px; background:#777; color:white; cursor:pointer;">${escaparHtml(cancelar)}</button>` : ''}
                        <button id="sprndsDialogoConfirmar" type="button" style="padding:9px 14px; border:none; border-radius:4px; background:${cor}; color:white; cursor:pointer; font-weight:bold;">${escaparHtml(confirmar)}</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const input = overlay.querySelector('#sprndsDialogoCampo');
            const fechar = (valor) => {
                try { overlay.remove(); } catch (e) {}
                resolve(valor);
            };
            overlay.querySelector('#sprndsDialogoConfirmar').onclick = () => fechar(campo ? (input?.value ?? '') : true);
            const btnCancelar = overlay.querySelector('#sprndsDialogoCancelar');
            if (btnCancelar) btnCancelar.onclick = () => fechar(campo ? null : false);
            input?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') overlay.querySelector('#sprndsDialogoConfirmar')?.click(); });
            setTimeout(() => (input || overlay.querySelector('#sprndsDialogoConfirmar'))?.focus(), 50);
        });
    }

    async function appAlert(mensagem, titulo = 'SPRNDS', tipo = 'info') {
        console.log(`[${titulo}] ${mensagem}`);
        mostrarMensagemInterna(tipo, titulo, mensagem, { persistente: tipo === 'erro' || tipo === 'alerta' });
        return true;
    }

    async function appConfirm(mensagem, titulo = 'Confirmação', tipo = 'alerta', confirmar = 'Confirmar', cancelar = 'Cancelar') {
        console.log(`[${titulo}] ${mensagem}`);
        return await mostrarDialogoInterno({ titulo, mensagem, tipo, confirmar, cancelar });
    }

    async function appPrompt(mensagem, titulo = 'Entrada necessária', campo = 'Valor', senha = false) {
        console.log(`[${titulo}] ${mensagem}`);
        return await mostrarDialogoInterno({ titulo, mensagem, tipo: 'info', confirmar: 'Usar', cancelar: 'Cancelar', campo, senha });
    }


    // ============================================
    // 🔐 RENOVAÇÃO AUTOMÁTICA DE SESSÃO / TOKEN SSO
    // ============================================

    function limparTokenUrlAtual() {
        try {
            if (window.location.hash && window.location.hash.includes('access_token=')) {
                history.replaceState(null, document.title, window.location.pathname + window.location.search);
            }
        } catch (e) {
            console.warn('⚠️ Não foi possível limpar access_token da URL:', e);
        }
    }

    function extrairTokenDeUrl(urlOuHash) {
        if (!urlOuHash) return '';
        try {
            const texto = String(urlOuHash);
            const hash = texto.includes('#') ? texto.split('#').slice(1).join('#') : texto.replace(/^#/, '');
            const paramsHash = new URLSearchParams(hash);
            const tokenHash = paramsHash.get('access_token') || paramsHash.get('token');
            if (tokenHash) return tokenHash;
            const url = new URL(texto, window.location.origin);
            const tokenQuery = url.searchParams.get('access_token') || url.searchParams.get('token');
            if (tokenQuery) return tokenQuery;
        } catch (e) {
            const match = String(urlOuHash).match(/(?:access_token|token)=([^&#]+)/i);
            if (match) return decodeURIComponent(match[1]);
        }
        return '';
    }

    function extrairExpiresInDeUrl(urlOuTexto) {
        if (!urlOuTexto) return 0;
        try {
            const texto = String(urlOuTexto);
            const hash = texto.includes('#') ? texto.split('#').slice(1).join('#') : texto.replace(/^#/, '');
            const paramsHash = new URLSearchParams(hash);
            const expHash = parseInt(paramsHash.get('expires_in') || paramsHash.get('expires') || '0', 10);
            if (Number.isFinite(expHash) && expHash > 0) return expHash;
            const url = new URL(texto, window.location.origin);
            const expQuery = parseInt(url.searchParams.get('expires_in') || url.searchParams.get('expires') || '0', 10);
            if (Number.isFinite(expQuery) && expQuery > 0) return expQuery;
        } catch (e) {
            const match = String(urlOuTexto).match(/(?:expires_in|expires)=([0-9]+)/i);
            if (match) return parseInt(match[1], 10) || 0;
        }
        return 0;
    }

    function salvarTokenCapturado(token, origem = 'desconhecida', contextoToken = '') {
        const limpo = String(token || '').replace(/^Bearer\s+/i, '').trim();
        if (!limpo || limpo.length < 20) return false;
        TOKEN_GLOBAL = limpo;
        TOKEN_CAPTURADO_EM = Date.now();
        const expiresIn = extrairExpiresInDeUrl(contextoToken);
        TOKEN_EXPIRA_EM = expiresIn > 0 ? TOKEN_CAPTURADO_EM + (expiresIn * 1000) : 0;
        localStorage.setItem('RNDS_TOKEN', TOKEN_GLOBAL);
        localStorage.setItem('RNDS_TOKEN_CAPTURED_AT', String(TOKEN_CAPTURADO_EM));
        if (TOKEN_EXPIRA_EM) localStorage.setItem('RNDS_TOKEN_EXPIRES_AT', String(TOKEN_EXPIRA_EM));
        else localStorage.removeItem('RNDS_TOKEN_EXPIRES_AT');
        atualizarBotaoToken(true);
        limparTokenUrlAtual();
        const validade = TOKEN_EXPIRA_EM ? ` | expira aprox. ${new Date(TOKEN_EXPIRA_EM).toLocaleTimeString()}` : '';
        console.log(`🔐 Token renovado/capturado via ${origem}${validade}`);
        return true;
    }

    function capturarTokenDaUrlAtual() {
        const token = extrairTokenDeUrl(window.location.href) || extrairTokenDeUrl(window.location.hash);
        if (token) return salvarTokenCapturado(token, 'URL atual', window.location.href || window.location.hash);
        return false;
    }

    function respostaPareceSessaoExpirada(response, body, texto) {
        const http = response?.status || 0;
        const urlFinal = normalizarTexto(response?.url || '');
        const contentType = normalizarTexto(response?.headers?.get?.('content-type') || '');
        const mensagem = normalizarTexto(extrairMensagem(body, texto));
        const corpo = normalizarTexto(String(texto || '').slice(0, 2500));
        const combinado = `${urlFinal} ${contentType} ${mensagem} ${corpo}`;
        if ([401, 419, 440].includes(http)) return true;
        if (http === 403 && (combinado.includes('token') || combinado.includes('sessao') || combinado.includes('session') || combinado.includes('expir') || combinado.includes('unauthorized') || combinado.includes('forbidden'))) return true;
        if (urlFinal.includes('/api/oauth2/implicit') || urlFinal.includes('/mvsso/oauth2.0/authorize') || urlFinal.includes('/login') || combinado.includes('access_token=') || combinado.includes('response_type=token') || combinado.includes('settokensso') || combinado.includes('navigatetologin')) return true;
        if (contentType.includes('text/html') && (combinado.includes('<html') || combinado.includes('oauth') || combinado.includes('login') || combinado.includes('authorize'))) return true;
        return false;
    }

    function tokenPrecisaRenovacaoPreventiva() {
        if (!CONFIG.renovarTokenPreventivamente) return false;
        if (!TOKEN_GLOBAL) return true;
        const agora = Date.now();
        if (TOKEN_EXPIRA_EM && (TOKEN_EXPIRA_EM - agora) <= CONFIG.renovarSeTokenExpiraEmMs) return true;
        if (!TOKEN_EXPIRA_EM && TOKEN_CAPTURADO_EM && (agora - TOKEN_CAPTURADO_EM) >= CONFIG.renovarTokenACadaMs) return true;
        return false;
    }

    async function renovarSessaoViaFetchOAuth() {
        const url = `${CONFIG.oauthImplicitUrl}${CONFIG.oauthImplicitUrl.includes('?') ? '&' : '?'}_rn=${Date.now()}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.tempoMaximoReloginMs);
        try {
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            clearTimeout(timeoutId);

            const urlFinal = response.url || '';
            const texto = await response.text().catch(() => '');
            const token = extrairTokenDeUrl(urlFinal) || extrairTokenDeUrl(texto);
            if (token && salvarTokenCapturado(token, 'fetch OAuth implicit', urlFinal || texto)) {
                return true;
            }

            const resumo = normalizarTexto(`${urlFinal} ${texto.slice(0, 1200)}`);
            if (resumo.includes('login') || resumo.includes('senha') || resumo.includes('password') || resumo.includes('unauthorized') || resumo.includes('forbidden')) {
                console.warn('⚠️ Renovação via fetch chegou em tela de login/autorização sem access_token. SSO provavelmente expirou.');
            } else {
                console.warn('⚠️ Renovação via fetch não encontrou access_token no redirect/resposta OAuth.');
            }
            return false;
        } catch (e) {
            clearTimeout(timeoutId);
            console.warn('⚠️ Falha na renovação via fetch OAuth:', e?.message || e);
            return false;
        }
    }

    function iniciarWatchdogSessao() {
        if (!CONFIG.renovarTokenPreventivamente || watchdogSessaoTimer) return;
        watchdogSessaoTimer = setInterval(async () => {
            if (!estado.processando || estado.cancelado || estado.relogando || estado.sessaoBloqueada) return;
            if (!tokenPrecisaRenovacaoPreventiva()) return;
            estado.ultimaRenovacaoPreventiva = Date.now();
            if (estado.statusDetalhado) estado.statusDetalhado.renovacaoPreventiva = (estado.statusDetalhado.renovacaoPreventiva || 0) + 1;
            console.log('🔐 Watchdog: renovando token preventivamente para evitar expiração durante lote longo');
            await tentarRenovarSessaoAutomaticamente('renovação preventiva do watchdog', true);
        }, CONFIG.intervaloWatchdogSessaoMs);
    }

    function pararWatchdogSessao() {
        if (watchdogSessaoTimer) {
            clearInterval(watchdogSessaoTimer);
            watchdogSessaoTimer = null;
        }
    }


    function mascararLogin(login) {
        const texto = String(login || '');
        if (texto.length <= 3) return texto ? '***' : '';
        return texto.slice(0, 2) + '***' + texto.slice(-1);
    }

    async function solicitarCredenciaisLogin(motivo = '') {
        if (credenciaisLoginPromise) return await credenciaisLoginPromise;
        credenciaisLoginPromise = new Promise((resolve) => {
            const existente = document.getElementById('modalCredenciaisRnds');
            if (existente) existente.remove();

            const modal = document.createElement('div');
            modal.id = 'modalCredenciaisRnds';
            modal.innerHTML = `
                <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.72); z-index: 1000000; display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; width: 460px; max-width: calc(100vw - 30px); border-radius: 8px; padding: 22px; box-shadow: 0 8px 30px rgba(0,0,0,.35); font-family: Arial, sans-serif;">
                        <h2 style="margin: 0 0 12px 0; color: #1565c0; font-size: 20px;">🔐 Credenciais para re-login automático</h2>
                        <p style="font-size: 13px; line-height: 1.45; color: #444; margin: 0 0 12px 0;">
                            ${motivo ? String(motivo).replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s])).slice(0, 180) + '<br><br>' : ''}
                            As credenciais serão mantidas <strong>somente em memória</strong> enquanto esta aba estiver aberta. Não serão gravadas no script, checkpoint, localStorage ou CSV.
                        </p>
                        <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 4px;">Usuário/Login</label>
                        <input id="rndsLoginUsuario" autocomplete="username" style="width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #bbb; border-radius: 4px; margin-bottom: 12px;" />
                        <label style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 4px;">Senha</label>
                        <input id="rndsLoginSenha" type="password" autocomplete="current-password" style="width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #bbb; border-radius: 4px; margin-bottom: 14px;" />
                        <div style="background: #fff8e1; border-left: 4px solid #ffc107; padding: 10px; font-size: 12px; color: #5d4037; margin-bottom: 14px;">
                            Use apenas em computador confiável. A senha será apagada ao finalizar/cancelar se a configuração padrão estiver ativa.
                        </div>
                        <div style="display: flex; gap: 10px; justify-content: flex-end;">
                            <button id="rndsLoginCancelar" style="padding: 9px 14px; border: none; border-radius: 4px; background: #777; color: white; cursor: pointer;">Cancelar</button>
                            <button id="rndsLoginSalvar" style="padding: 9px 14px; border: none; border-radius: 4px; background: #1565c0; color: white; cursor: pointer; font-weight: bold;">Usar nesta execução</button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            const inputUsuario = modal.querySelector('#rndsLoginUsuario');
            const inputSenha = modal.querySelector('#rndsLoginSenha');
            const btnSalvar = modal.querySelector('#rndsLoginSalvar');
            const btnCancelar = modal.querySelector('#rndsLoginCancelar');

            function finalizar(valor) {
                try { modal.remove(); } catch (e) {}
                credenciaisLoginPromise = null;
                resolve(valor);
            }

            btnSalvar.onclick = () => {
                const usuario = inputUsuario.value.trim();
                const senha = inputSenha.value;
                if (!usuario || !senha) {
                    appAlert('Informe usuário e senha para o re-login automático.', 'Credenciais incompletas', 'alerta');
                    return;
                }
                credenciaisLoginMemoria = { usuario, senha, criadaEm: Date.now() };
                console.log(`🔐 Credenciais de re-login carregadas em memória para ${mascararLogin(usuario)}. Nada foi salvo em storage.`);
                finalizar(credenciaisLoginMemoria);
            };
            btnCancelar.onclick = () => finalizar(null);
            inputSenha.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') btnSalvar.click(); });
            inputUsuario.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inputSenha.focus(); });
            setTimeout(() => inputUsuario.focus(), 50);
        });
        return await credenciaisLoginPromise;
    }

    async function obterCredenciaisLogin(motivo = '') {
        if (!CONFIG.habilitarLoginAutomaticoComCredenciais) return null;
        if (credenciaisLoginMemoria?.usuario && credenciaisLoginMemoria?.senha) return credenciaisLoginMemoria;
        return await solicitarCredenciaisLogin(motivo || 'O script precisa renovar a sessão automaticamente durante a execução longa.');
    }

    function limparCredenciaisLoginMemoria() {
        if (credenciaisLoginMemoria) {
            credenciaisLoginMemoria.senha = '';
            credenciaisLoginMemoria = null;
            console.log('🔐 Credenciais de re-login apagadas da memória da aba.');
        }
    }

    function prepararPopupReloginAntecipado() {
        if (!CONFIG.habilitarLoginAutomaticoComCredenciais || !CONFIG.abrirPopupReloginAntecipado) return;
        try {
            if (popupReloginPreAberto && !popupReloginPreAberto.closed) return;
            popupReloginPreAberto = window.open('', 'SPRNDS_RELOGIN_AUTOMATICO', 'width=520,height=760,left=80,top=80');
            if (popupReloginPreAberto) {
                popupReloginPreAberto.document.open();
                popupReloginPreAberto.document.write('<!doctype html><title>SPRNDS re-login</title><body style="font-family:Arial;padding:20px"><h3>SPRNDS re-login automático</h3><p>Esta janela será usada se a sessão expirar durante o reenvio. Pode deixá-la aberta em segundo plano.</p></body>');
                popupReloginPreAberto.document.close();
                console.log('🔐 Janela de re-login antecipada preparada para evitar bloqueio de popup durante execução longa.');
            } else {
                console.warn('⚠️ Navegador bloqueou a janela antecipada de re-login. Se a sessão expirar, talvez seja necessário liberar popups.');
            }
        } catch (e) {
            console.warn('⚠️ Não foi possível preparar popup de re-login:', e?.message || e);
        }
    }

    function dispararEventosInput(el, valor) {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set;
        if (setter) setter.call(el, valor);
        else el.value = valor;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    function encontrarCampoUsuario(doc, senhaInput) {
        const candidatos = Array.from(doc.querySelectorAll('input'))
            .filter(i => !['hidden', 'password', 'submit', 'button', 'checkbox', 'radio'].includes((i.type || '').toLowerCase()))
            .filter(i => !i.disabled && i.offsetParent !== null);

        const porNome = candidatos.find(i => /user|usuario|usuário|login|cpf|email|mail|matricula|j_username|username/i.test(`${i.name || ''} ${i.id || ''} ${i.placeholder || ''} ${i.autocomplete || ''}`));
        if (porNome) return porNome;

        if (senhaInput) {
            const todos = Array.from(doc.querySelectorAll('input'));
            const idxSenha = todos.indexOf(senhaInput);
            for (let i = idxSenha - 1; i >= 0; i--) {
                const el = todos[i];
                const tipo = (el.type || '').toLowerCase();
                if (!['hidden', 'password', 'submit', 'button', 'checkbox', 'radio'].includes(tipo) && !el.disabled) return el;
            }
        }
        return candidatos[0] || null;
    }

    function tentarPreencherESubmeterLogin(popup, credenciais, controle) {
        const doc = popup?.document;
        if (!doc || !credenciais) return false;
        const senhaInput = doc.querySelector('input[type="password"]');
        if (!senhaInput) return false;

        const usuarioInput = encontrarCampoUsuario(doc, senhaInput);
        if (!usuarioInput) return false;

        const hrefAtual = (() => { try { return popup.location.href; } catch (e) { return ''; } })();
        const chavePagina = hrefAtual + '|' + (doc.title || '');
        if (controle.ultimaPaginaSubmetida === chavePagina && controle.submissoes >= CONFIG.maxSubmissoesFormularioLogin) return false;
        if (controle.ultimaPaginaSubmetida !== chavePagina) {
            controle.ultimaPaginaSubmetida = chavePagina;
            controle.submissoes = 0;
        }

        dispararEventosInput(usuarioInput, credenciais.usuario);
        dispararEventosInput(senhaInput, credenciais.senha);

        controle.submissoes++;
        console.log(`🔐 Preenchendo formulário de login automaticamente (${controle.submissoes}/${CONFIG.maxSubmissoesFormularioLogin}) para ${mascararLogin(credenciais.usuario)}.`);

        const form = senhaInput.form || usuarioInput.form || doc.querySelector('form');
        const botao = form?.querySelector('button[type="submit"], input[type="submit"], button:not([type]), .btn-primary, .mat-raised-button, .mat-button')
            || doc.querySelector('button[type="submit"], input[type="submit"], button:not([type])');

        if (botao && !botao.disabled) {
            botao.click();
            return true;
        }
        if (form) {
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
            return true;
        }
        senhaInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        return true;
    }

    async function renovarSessaoComCredenciais(motivo = '') {
        if (!CONFIG.habilitarLoginAutomaticoComCredenciais) return false;
        const credenciais = await obterCredenciaisLogin(motivo);
        if (!credenciais) return false;

        return await new Promise((resolve) => {
            const inicio = Date.now();
            const urlInicial = `${CONFIG.oauthImplicitUrl}${CONFIG.oauthImplicitUrl.includes('?') ? '&' : '?'}_rn=${Date.now()}`;
            let popup = null;
            let finalizado = false;
            let timer = null;
            const controle = { ultimaPaginaSubmetida: '', submissoes: 0 };

            function finalizar(ok, detalhe = '') {
                if (finalizado) return;
                finalizado = true;
                if (timer) clearInterval(timer);
                if (ok) {
                    try { popup?.close?.(); } catch (e) {}
                    popupReloginPreAberto = null;
                    console.log(`✅ Re-login automático com credenciais concluído${detalhe ? ': ' + detalhe : ''}`);
                } else {
                    console.warn(`⚠️ Re-login automático com credenciais falhou${detalhe ? ': ' + detalhe : ''}`);
                }
                resolve(ok);
            }

            try {
                popup = (popupReloginPreAberto && !popupReloginPreAberto.closed) ? popupReloginPreAberto : window.open('', 'SPRNDS_RELOGIN_AUTOMATICO', 'width=520,height=760,left=80,top=80');
                if (!popup) {
                    finalizar(false, 'popup bloqueado pelo navegador');
                    return;
                }
                popupReloginPreAberto = popup;
                popup.location.href = urlInicial;
                popup.focus?.();
            } catch (e) {
                finalizar(false, e?.message || e);
                return;
            }

            function verificar() {
                if (finalizado) return;
                try {
                    const href = popup.location.href || '';
                    const hash = popup.location.hash || '';
                    const token = extrairTokenDeUrl(href) || extrairTokenDeUrl(hash);
                    if (token && salvarTokenCapturado(token, 'popup login automático', href || hash)) {
                        finalizar(true, 'token recebido no redirect OAuth');
                        return;
                    }
                    tentarPreencherESubmeterLogin(popup, credenciais, controle);
                } catch (e) {
                    // Enquanto estiver em origem diferente, apenas aguardamos o redirect de volta.
                }

                if (popup.closed) {
                    finalizar(false, 'janela de login foi fechada');
                    return;
                }
                if ((Date.now() - inicio) > CONFIG.tempoMaximoLoginCredenciaisMs) {
                    finalizar(false, `timeout de ${(CONFIG.tempoMaximoLoginCredenciaisMs / 1000).toFixed(0)}s`);
                }
            }

            timer = setInterval(verificar, 750);
            setTimeout(verificar, 800);
        });
    }

    async function renovarSessaoViaIframe() {
        return await new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.width = '1px';
            iframe.style.height = '1px';
            iframe.style.opacity = '0';
            iframe.style.pointerEvents = 'none';
            iframe.style.left = '-9999px';
            iframe.style.top = '-9999px';
            iframe.setAttribute('aria-hidden', 'true');
            const inicio = Date.now();
            let finalizado = false;
            let timer = null;
            function finalizar(ok, detalhe = '') {
                if (finalizado) return;
                finalizado = true;
                if (timer) clearInterval(timer);
                try { iframe.remove(); } catch (e) {}
                if (ok) console.log(`✅ Relogin/renovação automática concluída${detalhe ? ': ' + detalhe : ''}`);
                else console.warn(`⚠️ Relogin automático não conseguiu renovar token${detalhe ? ': ' + detalhe : ''}`);
                resolve(ok);
            }
            function verificar() {
                if (finalizado) return;
                try {
                    const href = iframe.contentWindow?.location?.href || '';
                    const hash = iframe.contentWindow?.location?.hash || '';
                    const token = extrairTokenDeUrl(href) || extrairTokenDeUrl(hash);
                    if (token && salvarTokenCapturado(token, 'iframe OAuth implicit', href || hash)) {
                        finalizar(true, 'token recebido no redirect OAuth');
                        return;
                    }
                } catch (e) {}
                if ((Date.now() - inicio) > CONFIG.tempoMaximoReloginMs) finalizar(false, `timeout de ${(CONFIG.tempoMaximoReloginMs / 1000).toFixed(0)}s`);
            }
            iframe.onload = verificar;
            timer = setInterval(verificar, 500);
            iframe.src = `${CONFIG.oauthImplicitUrl}${CONFIG.oauthImplicitUrl.includes('?') ? '&' : '?'}_rn=${Date.now()}`;
            document.body.appendChild(iframe);
        });
    }

    async function tentarRenovarSessaoAutomaticamente(motivo = '', preventivo = false) {
        if (!CONFIG.habilitarReloginAutomatico) return false;
        if (estado.sessaoBloqueada && !preventivo) return false;
        if (reloginPromise) return await reloginPromise;
        reloginPromise = (async () => {
            const pausadoAntes = estado.pausado;
            estado.relogando = true;
            estado.pausado = true;
            if (!preventivo) {
                estado.totalSessaoExpirada = (estado.totalSessaoExpirada || 0) + 1;
                if (estado.statusDetalhado) estado.statusDetalhado.sessaoExpirada = (estado.statusDetalhado.sessaoExpirada || 0) + 1;
            }
            atualizarModal(`🔐 ${preventivo ? 'Renovando token preventivamente' : 'Sessão expirada. Tentando renovar token'}${motivo ? ': ' + String(motivo).slice(0, 120) : ''}...`);
            atualizarBotoesDuranteExecucao();
            try {
                capturarTokenDaUrlAtual();
                const tokenAnterior = TOKEN_GLOBAL;
                let ok = await renovarSessaoViaFetchOAuth();
                if (!ok && CONFIG.permitirFallbackIframeRelogin) {
                    ok = await renovarSessaoViaIframe();
                }
                if (!ok && CONFIG.habilitarLoginAutomaticoComCredenciais) {
                    ok = await renovarSessaoComCredenciais(motivo || 'Sessão expirada durante o reenvio');
                }
                if (ok && TOKEN_GLOBAL && TOKEN_GLOBAL !== tokenAnterior) {
                    estado.totalReloginSucesso = (estado.totalReloginSucesso || 0) + 1;
                    estado.falhasReloginConsecutivas = 0;
                    estado.sessaoBloqueada = false;
                    if (estado.statusDetalhado) estado.statusDetalhado.reloginSucesso = (estado.statusDetalhado.reloginSucesso || 0) + 1;
                    estado.ultimoRelogin = Date.now();
                    atualizarModal('🔐 Sessão/token renovado. Retomando reenvio...');
                    await new Promise(r => setTimeout(r, CONFIG.cooldownReloginMs));
                    return true;
                }
                estado.totalReloginFalha = (estado.totalReloginFalha || 0) + 1;
                estado.falhasReloginConsecutivas = (estado.falhasReloginConsecutivas || 0) + 1;
                if (estado.statusDetalhado) estado.statusDetalhado.reloginFalha = (estado.statusDetalhado.reloginFalha || 0) + 1;

                if (estado.falhasReloginConsecutivas >= CONFIG.maxFalhasReloginConsecutivas && CONFIG.pausarAoFalharRelogin) {
                    estado.sessaoBloqueada = true;
                    estado.pausado = true;
                    if (estado.statusDetalhado) estado.statusDetalhado.reloginBloqueado = (estado.statusDetalhado.reloginBloqueado || 0) + 1;
                    atualizarModal('🛑 Sessão bloqueada: renovação/login automático falhou. Verifique credenciais ou faça login manual antes de continuar.');
                } else {
                    atualizarModal('⚠️ Não foi possível renovar a sessão automaticamente. Nova tentativa ocorrerá se necessário.');
                }
                return false;
            } finally {
                estado.relogando = false;
                if (!estado.sessaoBloqueada && !pausadoAntes) estado.pausado = false;
                atualizarBotoesDuranteExecucao();
                setTimeout(() => { reloginPromise = null; }, 250);
            }
        })();
        return await reloginPromise;
    }

    // ============================================
    // 🌐 API - PAGINAÇÃO COM FILTRO DE DATA E STATUS
    // ============================================

    async function buscarVacinasComErro(page = 0, limit = 15, status = 'ERROR', tentativaSessao = 0) {
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

            const { body, texto } = await lerCorpoResposta(response);

            if (respostaPareceSessaoExpirada(response, body, texto)) {
                if (tentativaSessao < CONFIG.maxTentativasRelogin && await tentarRenovarSessaoAutomaticamente(`busca página ${page} (${status})`)) {
                    return await buscarVacinasComErro(page, limit, status, tentativaSessao + 1);
                }
                throw new Error(`SESSAO_EXPIRADA HTTP ${response.status}`);
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const dados = body || (texto ? JSON.parse(texto) : {});

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

    async function lerCorpoResposta(response) {
        const contentType = response.headers.get('content-type') || '';
        const texto = await response.text();

        if (!texto) {
            return { body: null, texto: '' };
        }

        if (contentType.includes('application/json')) {
            try {
                return { body: JSON.parse(texto), texto };
            } catch (e) {
                return { body: null, texto };
            }
        }

        try {
            return { body: JSON.parse(texto), texto };
        } catch (e) {
            return { body: null, texto };
        }
    }

    function normalizarTexto(valor) {
        return String(valor || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function valorParaTexto(valor) {
        if (valor === null || valor === undefined) return '';
        if (typeof valor === 'string') return valor;
        if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
        try {
            return JSON.stringify(valor);
        } catch (e) {
            return String(valor);
        }
    }

    function pegarPrimeiroValor(obj, caminhos) {
        if (!obj || typeof obj !== 'object') return '';

        for (const caminho of caminhos) {
            const partes = caminho.split('.');
            let atual = obj;

            for (const parte of partes) {
                if (atual && Object.prototype.hasOwnProperty.call(atual, parte)) {
                    atual = atual[parte];
                } else {
                    atual = undefined;
                    break;
                }
            }

            if (atual !== undefined && atual !== null && atual !== '') {
                return atual;
            }
        }

        return '';
    }

    function limparIdentificadorPaciente(valor) {
        return valorParaTexto(valor).trim();
    }

    function extrairCpfPaciente(registro) {
        const valor = pegarPrimeiroValor(registro, [
            'pacientCpf', 'patientCpf', 'pacienteCpf', 'cpfPaciente', 'cpf', 'CPF',
            'personCpf', 'citizenCpf', 'beneficiaryCpf', 'individualCpf', 'userCpf',
            'pacient.cpf', 'patient.cpf', 'paciente.cpf', 'person.cpf', 'citizen.cpf',
            'data.pacientCpf', 'data.patientCpf', 'data.cpf', 'data.patient.cpf', 'data.paciente.cpf',
            'content.pacientCpf', 'content.patientCpf', 'content.cpf'
        ]);
        return limparIdentificadorPaciente(valor) || 'N/A';
    }

    function extrairCnsPaciente(registro) {
        const valor = pegarPrimeiroValor(registro, [
            'pacientCns', 'patientCns', 'pacienteCns', 'pacientCNS', 'patientCNS', 'CNS', 'cns',
            'cnsPaciente', 'pacienteCNS', 'numeroCns', 'numeroCNS', 'cnsNumber', 'patientCnsNumber',
            'cartaoSus', 'cartaoSUS', 'numeroCartaoSus', 'numeroCartaoSUS', 'susCard', 'susCardNumber',
            'susNumber', 'nationalHealthCard', 'patientNationalHealthCard', 'pacientNationalHealthCard',
            'patientSusCard', 'pacientSusCard', 'cidadaoCns', 'citizenCns', 'beneficiaryCns',
            'pacient.cns', 'patient.cns', 'paciente.cns', 'person.cns', 'citizen.cns', 'beneficiary.cns',
            'pacient.cartaoSus', 'patient.cartaoSus', 'paciente.cartaoSus', 'patient.susCard',
            'data.pacientCns', 'data.patientCns', 'data.cns', 'data.CNS', 'data.patient.cns', 'data.paciente.cns',
            'content.pacientCns', 'content.patientCns', 'content.cns', 'content.CNS'
        ]);
        return limparIdentificadorPaciente(valor) || 'N/A';
    }

    function extrairNomePaciente(registro) {
        const valor = pegarPrimeiroValor(registro, [
            'pacientName', 'patientName', 'pacienteNome', 'nomePaciente', 'patientFullName', 'pacientFullName',
            'pacienteNomeCompleto', 'nomeCompletoPaciente', 'personName', 'citizenName', 'beneficiaryName',
            'individualName', 'userName', 'nomeCidadao', 'cidadaoNome', 'nomeUsuario',
            'pacient.name', 'patient.name', 'paciente.nome', 'person.name', 'citizen.name', 'beneficiary.name',
            'individual.name', 'usuario.nome', 'cidadao.nome',
            'pacient.fullName', 'patient.fullName', 'paciente.nomeCompleto', 'person.fullName', 'citizen.fullName',
            'data.pacientName', 'data.patientName', 'data.nomePaciente', 'data.pacienteNome',
            'data.patient.name', 'data.paciente.nome', 'data.person.name', 'data.citizen.name',
            'content.pacientName', 'content.patientName', 'content.nomePaciente', 'content.patient.name',
            // Campos genéricos por último, pois em alguns payloads podem representar outro objeto.
            'nome', 'name', 'fullName'
        ]);
        return valorParaTexto(valor).trim() || 'N/A';
    }

    function extrairDadosPaciente(registro) {
        return {
            nome: extrairNomePaciente(registro),
            cns: extrairCnsPaciente(registro),
            cpf: extrairCpfPaciente(registro)
        };
    }

    function extrairMensagem(body, texto) {
        const caminhos = [
            'message', 'mensagem', 'error', 'erro', 'detail', 'details', 'reason', 'description',
            'data.message', 'data.mensagem', 'data.error', 'data.erro', 'data.detail', 'data.details',
            'result.message', 'result.mensagem', 'result.error', 'result.erro',
            'content.message', 'content.mensagem', 'content.error', 'content.erro'
        ];

        const valores = [];

        if (body && typeof body === 'object') {
            for (const caminho of caminhos) {
                const valor = pegarPrimeiroValor(body, [caminho]);
                if (valor !== '' && valor !== undefined && valor !== null) {
                    valores.push(valorParaTexto(valor));
                }
            }

            if (Array.isArray(body.errors)) valores.push(body.errors.map(valorParaTexto).join(' | '));
            if (Array.isArray(body.erros)) valores.push(body.erros.map(valorParaTexto).join(' | '));
            if (Array.isArray(body.data?.errors)) valores.push(body.data.errors.map(valorParaTexto).join(' | '));
            if (Array.isArray(body.data?.erros)) valores.push(body.data.erros.map(valorParaTexto).join(' | '));
        }

        const unicos = [...new Set(valores.filter(Boolean))];
        return unicos.join(' | ') || texto || '';
    }

    function extrairStatusNegocio(body) {
        const caminhos = [
            'sendStatus', 'status', 'situation', 'situacao', 'syncStatus', 'rnDsStatus', 'rndsStatus',
            'data.sendStatus', 'data.status', 'data.situation', 'data.situacao', 'data.syncStatus', 'data.rndsStatus',
            'result.sendStatus', 'result.status', 'content.sendStatus', 'content.status'
        ];

        const valor = pegarPrimeiroValor(body, caminhos);
        return String(valor || '').toUpperCase();
    }

    function classificarResultado(response, body, texto) {
        const http = response.status;
        const mensagem = extrairMensagem(body, texto);
        const statusNegocio = extrairStatusNegocio(body);
        const conteudo = `${normalizarTexto(mensagem)} ${normalizarTexto(statusNegocio)} ${normalizarTexto(texto)}`;
        const tem = (...termos) => termos.some(t => conteudo.includes(normalizarTexto(t)));

        if (respostaPareceSessaoExpirada(response, body, texto)) {
            return {
                status: 'ERRO_SESSAO_EXPIRADA',
                categoria: 'SESSAO_EXPIRADA',
                retryable: true,
                conclusivo: false,
                severidade: 'AUTH_SESSAO',
                mensagem: mensagem || `Sessão expirada ou redirecionada para login (HTTP ${http})`
            };
        }

        if (tem('java.lang.outofmemoryerror', 'outofmemoryerror', 'java heap space', 'gc overhead limit exceeded', 'unable to create new native thread')) {
            return {
                status: 'ERRO_SERVIDOR_JAVA_HEAP',
                categoria: 'JAVA_OUT_OF_MEMORY',
                retryable: true,
                conclusivo: false,
                severidade: 'CRITICA_BACKEND',
                mensagem: mensagem || 'Servidor Java sem memória heap'
            };
        }

        if (http === 401 || http === 403) {
            return {
                status: 'ERRO_AUTH',
                categoria: http === 401 ? 'TOKEN_EXPIRADO_OU_INVALIDO' : 'SEM_PERMISSAO',
                retryable: false,
                conclusivo: true,
                mensagem: mensagem || `HTTP ${http}`
            };
        }

        if (http === 429) {
            return {
                status: 'RATE_LIMIT',
                categoria: 'MUITAS_REQUISICOES',
                retryable: true,
                conclusivo: false,
                mensagem: mensagem || 'HTTP 429 - muitas requisições'
            };
        }

        if (http >= 500) {
            return {
                status: 'ERRO_SERVIDOR',
                categoria: `HTTP_${http}`,
                retryable: true,
                conclusivo: false,
                mensagem: mensagem || `HTTP ${http}`
            };
        }

        if (!response.ok) {
            if (http === 400 || http === 422) {
                return {
                    status: 'ERRO_VALIDACAO',
                    categoria: 'REQUISICAO_INVALIDA_OU_DADO_INVALIDO',
                    retryable: false,
                    conclusivo: true,
                    mensagem: mensagem || `HTTP ${http}`
                };
            }

            if (http === 404) {
                return {
                    status: 'NAO_ENCONTRADO',
                    categoria: 'REGISTRO_NAO_ENCONTRADO',
                    retryable: false,
                    conclusivo: true,
                    mensagem: mensagem || 'Registro não encontrado'
                };
            }

            if (http === 409) {
                return {
                    status: 'CONFLITO',
                    categoria: 'DUPLICIDADE_OU_ESTADO_INCOMPATIVEL',
                    retryable: false,
                    conclusivo: true,
                    mensagem: mensagem || 'Conflito no envio'
                };
            }

            return {
                status: 'ERRO_HTTP',
                categoria: `HTTP_${http}`,
                retryable: false,
                conclusivo: true,
                mensagem: mensagem || `HTTP ${http}`
            };
        }

        if (
            ['SUCCESS', 'SUCESSO', 'SENT', 'ENVIADO', 'DONE', 'OK', 'FINALIZED', 'FINALIZADO'].includes(statusNegocio) ||
            tem('enviado com sucesso', 'sucesso ao enviar', 'registro enviado', 'envio realizado', 'sincronizado com sucesso')
        ) {
            return {
                status: 'SUCESSO_CONFIRMADO',
                categoria: 'ENVIADO',
                retryable: false,
                conclusivo: true,
                mensagem: mensagem || 'Envio confirmado'
            };
        }

        if (tem('ja enviado', 'ja foi enviado', 'ja existe', 'duplicidade', 'duplicado', 'already exists', 'already sent', 'registro existente')) {
            return {
                status: 'JA_EXISTIA',
                categoria: 'DUPLICADO_OU_JA_ENVIADO',
                retryable: false,
                conclusivo: true,
                mensagem: mensagem || 'Registro já existia ou já havia sido enviado'
            };
        }

        if (
            ['PENDING', 'PENDENTE', 'PROCESSING', 'PROCESSANDO', 'QUEUED', 'FILA', 'WAITING', 'AGUARDANDO'].includes(statusNegocio) ||
            http === 202 ||
            tem('pendente', 'processando', 'fila', 'aguardando', 'aceito para processamento')
        ) {
            return {
                status: 'ACEITO_PENDENTE',
                categoria: 'ACEITO_MAS_NAO_CONFIRMADO',
                retryable: false,
                conclusivo: false,
                mensagem: mensagem || 'Requisição aceita, mas resultado ainda pendente'
            };
        }

        if (
            ['ERROR', 'ERRO', 'FAILED', 'FALHA', 'FAIL', 'REJECTED', 'REJEITADO', 'INVALID', 'INVALIDO'].includes(statusNegocio) ||
            tem('erro de negocio', 'falha de validacao', 'erro de validacao', 'rejeitado', 'invalido', 'cnes', 'cpf', 'cns', 'lote', 'vacina nao encontrada', 'estabelecimento nao encontrado')
        ) {
            return {
                status: 'ERRO_NEGOCIO',
                categoria: 'REJEICAO_RNDS_OU_VALIDACAO',
                retryable: false,
                conclusivo: true,
                mensagem: mensagem || 'Erro de negócio retornado pela API'
            };
        }

        return {
            status: 'HTTP_OK_INDETERMINADO',
            categoria: 'RESPOSTA_2XX_SEM_CONFIRMACAO',
            retryable: false,
            conclusivo: false,
            mensagem: mensagem || 'HTTP 2xx, mas sem confirmação clara de sucesso'
        };
    }

    function analisarPressaoBackend(resultadosRecentes) {
        const total = resultadosRecentes.length || 0;
        const resumo = {
            total,
            javaOutOfMemory: 0,
            rateLimit: 0,
            erroServidor: 0,
            erroRede: 0,
            retryables: 0
        };

        resultadosRecentes.forEach(r => {
            if (r.categoria === 'JAVA_OUT_OF_MEMORY' || r.status === 'ERRO_SERVIDOR_JAVA_HEAP') resumo.javaOutOfMemory++;
            if (r.status === 'RATE_LIMIT') resumo.rateLimit++;
            if (r.status === 'ERRO_SERVIDOR') resumo.erroServidor++;
            if (r.status === 'ERRO_REDE') resumo.erroRede++;
            if (r.retryable) resumo.retryables++;
        });

        resumo.taxaRetryable = total > 0 ? (resumo.retryables / total) * 100 : 0;
        resumo.taxaServidor = total > 0 ? ((resumo.javaOutOfMemory + resumo.rateLimit + resumo.erroServidor) / total) * 100 : 0;
        return resumo;
    }

    function resetarJanelaSegurancaConcorrencia(novaConcorrencia = estado.concorrenciaAtual) {
        estado.concorrenciaAmostrada = novaConcorrencia;
        estado.amostrasNaConcorrenciaAtual = 0;
        estado.sucessosNaConcorrenciaAtual = 0;
        estado.falhasCriticasNaConcorrenciaAtual = 0;
    }

    function registrarAjusteConcorrencia(concorrenciaAnterior, novoValor, decisao, analise = null) {
        if (novoValor === concorrenciaAnterior) return false;

        const ajuste = {
            timestamp: Date.now(),
            de: concorrenciaAnterior,
            para: novoValor,
            decisao: decisao,
            analise: analise
        };

        estado.concorrenciaAtual = novoValor;
        estado.ajustesHistorico.push(ajuste);
        resetarJanelaSegurancaConcorrencia(novoValor);

        if (CONFIG.habilitarCheckpoint) {
            checkpointManager.registrarAjusteWorkers(ajuste);
        }

        console.warn(`🔻 ${decisao.acao}: workers ${concorrenciaAnterior} → ${novoValor}. ${decisao.razao}`);
        return true;
    }

    function aplicarReducaoCriticaBackend(resultado) {
        const agora = Date.now();

        if (resultado?.categoria === 'JAVA_OUT_OF_MEMORY' || resultado?.status === 'ERRO_SERVIDOR_JAVA_HEAP') {
            estado.totalOutOfMemory = (estado.totalOutOfMemory || 0) + 1;
            estado.ultimoHeapEm = agora;
            estado.cooldownAte = Math.max(estado.cooldownAte || 0, agora + CONFIG.cooldownOutOfMemoryMs);

            if ((agora - (estado.ultimaReducaoCriticaBackend || 0)) < CONFIG.janelaReducaoCriticaMs) {
                console.warn(`☕ Java heap/OutOfMemory detectado novamente. Mantendo cooldown até ${new Date(estado.cooldownAte).toLocaleTimeString()}.`);
                atualizarModal();
                return;
            }

            estado.ultimaReducaoCriticaBackend = agora;
            const anterior = estado.concorrenciaAtual;
            const novoValor = Math.max(CONFIG.concorrenciaMinima, Math.floor(anterior * CONFIG.fatorReducaoOutOfMemory));
            const tetoRecuperacao = Math.max(CONFIG.concorrenciaMinima, anterior - 1);

            estado.modoRecuperacaoBackend = true;
            estado.backendFragilAte = Math.max(estado.backendFragilAte || 0, agora + CONFIG.recuperacaoBackendMs);
            estado.tetoRecuperacaoBackend = estado.tetoRecuperacaoBackend
                ? Math.min(estado.tetoRecuperacaoBackend, tetoRecuperacao)
                : tetoRecuperacao;
            estado.sucessosDesdeHeap = 0;
            estado.ultimoWorkersComHeap = anterior;
            resetarJanelaSegurancaConcorrencia(novoValor);

            const decisao = {
                acao: 'REDUÇÃO_CRÍTICA_JAVA_HEAP',
                razao: 'Backend retornou java.lang.OutOfMemoryError / Java heap space; entrando em recuperação lenta',
                reducao: anterior - novoValor,
                cooldownMs: CONFIG.cooldownOutOfMemoryMs,
                recuperacaoMs: CONFIG.recuperacaoBackendMs,
                tetoRecuperacao: estado.tetoRecuperacaoBackend
            };

            registrarAjusteConcorrencia(anterior, novoValor, decisao);
            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.registrarHeapBackend(anterior, novoValor, estado.tetoRecuperacaoBackend);
            }
            atualizarModal(`☕ Java heap: workers ${anterior} → ${novoValor}. Recuperação lenta até teto ${estado.tetoRecuperacaoBackend}`);
            return;
        }
    }

    async function respeitarCooldownBackend() {
        while (estado.cooldownAte && Date.now() < estado.cooldownAte && !estado.cancelado) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    function calcularBackoff(tentativa, categoria) {
        if (categoria === 'JAVA_OUT_OF_MEMORY') {
            return CONFIG.cooldownOutOfMemoryMs;
        }

        const base = 1000;
        const max = 15000;
        const jitter = Math.floor(Math.random() * 500);
        return Math.min(base * Math.pow(2, tentativa - 1) + jitter, max);
    }

    function resultadoEhFalhaCriticaParaWorkersSeguro(resultado) {
        return (
            resultado?.categoria === 'JAVA_OUT_OF_MEMORY' ||
            resultado?.status === 'ERRO_SERVIDOR_JAVA_HEAP' ||
            resultado?.status === 'ERRO_SERVIDOR' ||
            resultado?.status === 'ERRO_REDE' ||
            resultado?.status === 'RATE_LIMIT' ||
            resultado?.status === 'TIMEOUT' ||
            resultado?.retryable === true
        );
    }

    function atualizarJanelaSegurancaConcorrencia(resultado) {
        if (!CONFIG.usarWorkersSeguroCheckpoint || !CONFIG.habilitarCheckpoint) return;

        if (estado.concorrenciaAmostrada !== estado.concorrenciaAtual) {
            resetarJanelaSegurancaConcorrencia(estado.concorrenciaAtual);
        }

        estado.amostrasNaConcorrenciaAtual++;

        if (statusContaComoSucesso(resultado.status)) {
            estado.sucessosNaConcorrenciaAtual++;
            estado.sucessosDesdeHeap = (estado.sucessosDesdeHeap || 0) + 1;
        }

        if (resultadoEhFalhaCriticaParaWorkersSeguro(resultado)) {
            estado.falhasCriticasNaConcorrenciaAtual++;
            if (resultado?.categoria === 'JAVA_OUT_OF_MEMORY' || resultado?.status === 'ERRO_SERVIDOR_JAVA_HEAP') {
                estado.sucessosDesdeHeap = 0;
            }
        }

        const janelaSuficiente =
            estado.amostrasNaConcorrenciaAtual >= CONFIG.minimoAmostrasWorkersSeguro &&
            estado.sucessosNaConcorrenciaAtual >= CONFIG.minimoSucessosWorkersSeguro &&
            estado.falhasCriticasNaConcorrenciaAtual <= CONFIG.maxFalhasCriticasWorkersSeguro;

        if (janelaSuficiente && estado.ultimoWorkersSeguroRegistrado !== estado.concorrenciaAtual) {
            const analise = analisarPerformance();
            checkpointManager.registrarWorkersSeguro(estado.concorrenciaAtual, {
                execucaoId: estado.iniciado,
                amostras: estado.amostrasNaConcorrenciaAtual,
                sucessos: estado.sucessosNaConcorrenciaAtual,
                falhasCriticas: estado.falhasCriticasNaConcorrenciaAtual,
                p95: analise?.p95 || null,
                taxaTimeout: analise?.taxaTimeout || null,
                modoRecuperacaoBackend: !!estado.modoRecuperacaoBackend
            });
            estado.ultimoWorkersSeguroRegistrado = estado.concorrenciaAtual;
        }
    }

    function backendEmRecuperacao() {
        return !!(estado.modoRecuperacaoBackend && estado.backendFragilAte && Date.now() < estado.backendFragilAte);
    }

    function encerrarRecuperacaoBackendSeExpirada() {
        if (estado.modoRecuperacaoBackend && estado.backendFragilAte && Date.now() >= estado.backendFragilAte) {
            estado.modoRecuperacaoBackend = false;
            estado.tetoRecuperacaoBackend = null;
            estado.sucessosDesdeHeap = 0;
            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.encerrarFragilidadeBackend();
            }
            console.log('✅ Recuperação pós-heap encerrada; auto-tuning normal reabilitado.');
        }
    }

    function avaliarAjusteRecuperacaoBackend(concorrenciaAnterior, analise) {
        if (!backendEmRecuperacao()) return null;

        const teto = Math.min(
            estado.tetoRecuperacaoBackend || CONFIG.concorrenciaMaxima,
            CONFIG.concorrenciaMaxima
        );

        const podeSubir =
            estado.sucessosDesdeHeap >= CONFIG.minimoSucessosParaSubirPosHeap &&
            analise.taxaTimeout < CONFIG.taxaTimeoutMaximaRecuperacao &&
            analise.p95 < CONFIG.timeoutRequisicao * CONFIG.p95MaximoRatioRecuperacao &&
            concorrenciaAnterior < teto;

        if (podeSubir) {
            const sucessosUsados = estado.sucessosDesdeHeap || 0;
            const novoValor = Math.min(
                concorrenciaAnterior + CONFIG.incrementoRecuperacaoBackend,
                teto
            );
            estado.sucessosDesdeHeap = 0;
            return {
                novoValor,
                decisao: {
                    acao: 'AUMENTO_LENTO_POS_HEAP',
                    razao: `Backend em recuperação pós-heap: ${CONFIG.minimoSucessosParaSubirPosHeap}+ sucessos sem heap; subindo apenas +${CONFIG.incrementoRecuperacaoBackend}`,
                    aumento: novoValor - concorrenciaAnterior,
                    tetoRecuperacao: teto,
                    sucessosDesdeHeap: sucessosUsados
                }
            };
        }

        return {
            novoValor: concorrenciaAnterior,
            decisao: {
                acao: 'MANTER_RECUPERACAO_POS_HEAP',
                razao: `Aguardando estabilidade pós-heap: ${estado.sucessosDesdeHeap || 0}/${CONFIG.minimoSucessosParaSubirPosHeap} sucessos; teto ${teto}`,
                tetoRecuperacao: teto,
                sucessosDesdeHeap: estado.sucessosDesdeHeap || 0
            }
        };
    }

    function finalizarResultadoReenvio(resultado) {
        incrementarResumoStatus(resultado);

        if (statusContaComoSucesso(resultado.status)) {
            estado.totalSucesso++;
            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.registrarProcessado(resultado.id, {
                    ...resultado,
                    status: 'SUCESSO'
                });
            }
        } else if (statusContaComoTimeout(resultado.status)) {
            estado.totalTimeout++;
            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.registrarProcessado(resultado.id, resultado);
            }
        } else {
            estado.totalErro++;
            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.registrarProcessado(resultado.id, resultado);
            }
        }

        atualizarJanelaSegurancaConcorrencia(resultado);
        return resultado;
    }

    async function reenviarVacina(registro, tentativa = 1, tentativaSessao = 0) {
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

            const { body, texto } = await lerCorpoResposta(response);
            const classificacao = classificarResultado(response, body, texto);
            const dadosPaciente = extrairDadosPaciente(registro);

            const resultado = {
                id: registro.id,
                nomePaciente: dadosPaciente.nome,
                cns: dadosPaciente.cns,
                cpf: dadosPaciente.cpf,
                vacina: registro.vaccineDescription || registro.vaccine || 'N/A',
                status: classificacao.status,
                categoria: classificacao.categoria,
                retryable: classificacao.retryable,
                conclusivo: classificacao.conclusivo,
                severidade: classificacao.severidade || '',
                statusCode: response.status,
                tentativa: tentativa,
                mensagem: classificacao.mensagem,
                erro: classificacao.mensagem,
                payloadBruto: texto,
                timestamp: new Date().toISOString(),
                latencia: latencia
            };

            if (classificacao.categoria === 'SESSAO_EXPIRADA') {
                if (tentativaSessao < CONFIG.maxTentativasRelogin) {
                    const renovou = await tentarRenovarSessaoAutomaticamente(classificacao.mensagem);
                    if (renovou) {
                        estado.totalRetentativas++;
                        return await reenviarVacina(registro, tentativa, tentativaSessao + 1);
                    }
                }
                return finalizarResultadoReenvio(resultado);
            }

            if (classificacao.categoria === 'JAVA_OUT_OF_MEMORY') {
                aplicarReducaoCriticaBackend(resultado);
            }

            if (classificacao.retryable && tentativa < CONFIG.maxRetentativas) {
                estado.totalRetentativas++;
                await new Promise(r => setTimeout(r, calcularBackoff(tentativa, classificacao.categoria)));
                return await reenviarVacina(registro, tentativa + 1, tentativaSessao);
            }

            return finalizarResultadoReenvio(resultado);

        } catch (erro) {
            const isTimeout = erro.name === 'AbortError';
            const latencia = Date.now() - inicioReq;

            if (isTimeout) {
                registrarLatencia(latencia, true, 0);
            }

            if (tentativa < CONFIG.maxRetentativas) {
                estado.totalRetentativas++;
                await new Promise(r => setTimeout(r, calcularBackoff(tentativa, isTimeout ? 'TIMEOUT_CLIENTE' : 'FALHA_TRANSPORTE')));
                return await reenviarVacina(registro, tentativa + 1, tentativaSessao);
            }

            const dadosPaciente = extrairDadosPaciente(registro);

            const resultado = {
                id: registro.id,
                nomePaciente: dadosPaciente.nome,
                cns: dadosPaciente.cns,
                cpf: dadosPaciente.cpf,
                vacina: registro.vaccineDescription || registro.vaccine || 'N/A',
                status: isTimeout ? 'TIMEOUT' : 'ERRO_REDE',
                categoria: isTimeout ? 'TIMEOUT_CLIENTE' : 'FALHA_TRANSPORTE',
                retryable: true,
                conclusivo: false,
                statusCode: 0,
                erro: erro.message,
                mensagem: erro.message,
                payloadBruto: '',
                tentativa: tentativa,
                timestamp: new Date().toISOString(),
                latencia: latencia
            };

            return finalizarResultadoReenvio(resultado);
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

                    await respeitarCooldownBackend();
                    if (estado.cancelado) {
                        console.log(`🛑 Worker #${workerId} cancelado após cooldown`);
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

                    if (statusContaComoSucesso(resultado.status)) {
                        metricas.sucessos++;
                    } else if (statusContaComoTimeout(resultado.status)) {
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


    function backendHysteresisPosHeapAtivo() {
        const ultimo = estado.ultimoHeapEm || checkpointManager.getResumo()?.backendFragil?.ultimoHeapEm || 0;
        return !!(ultimo && (Date.now() - ultimo) < CONFIG.hysteresisPosHeapMs);
    }

    function limitarAumentoPorHysteresisPosHeap(concorrenciaAnterior, novoValor, decisaoOriginal) {
        if (!backendHysteresisPosHeapAtivo() || novoValor <= concorrenciaAnterior) return null;

        const sucessosDesdeHeap = estado.sucessosDesdeHeap || 0;
        const tetoUltimoHeap = estado.ultimoWorkersComHeap ? Math.max(CONFIG.concorrenciaMinima, estado.ultimoWorkersComHeap - 1) : CONFIG.concorrenciaMaxima;
        const tetoSeguro = (CONFIG.limitarAumentoAoWorkersSeguroPosHeap && estado.ultimoWorkersSeguroRegistrado)
            ? Math.max(CONFIG.concorrenciaMinima, estado.ultimoWorkersSeguroRegistrado + CONFIG.margemWorkersSobreSeguroPosHeap)
            : CONFIG.concorrenciaMaxima;
        const teto = Math.max(CONFIG.concorrenciaMinima, Math.min(CONFIG.concorrenciaMaxima, tetoUltimoHeap, tetoSeguro));

        if (sucessosDesdeHeap < CONFIG.minimoSucessosParaSubirPosHeap) {
            return {
                novoValor: concorrenciaAnterior,
                decisao: {
                    acao: 'MANTER_HYSTERESIS_POS_HEAP',
                    razao: `Heap recente: aguardando ${CONFIG.minimoSucessosParaSubirPosHeap} sucessos antes de subir (${sucessosDesdeHeap}/${CONFIG.minimoSucessosParaSubirPosHeap}); teto ${teto}`,
                    decisaoOriginal,
                    tetoHysteresis: teto
                }
            };
        }

        const limitado = Math.min(
            novoValor,
            concorrenciaAnterior + CONFIG.incrementoMaximoNormalPosHeap,
            teto
        );

        if (limitado <= concorrenciaAnterior) {
            return {
                novoValor: concorrenciaAnterior,
                decisao: {
                    acao: 'MANTER_TETO_HYSTERESIS_POS_HEAP',
                    razao: `Heap recente: teto de recuperação/histórico seguro impede aumento acima de ${teto}`,
                    decisaoOriginal,
                    tetoHysteresis: teto
                }
            };
        }

        const sucessosUsados = estado.sucessosDesdeHeap || 0;
        estado.sucessosDesdeHeap = 0;
        return {
            novoValor: limitado,
            decisao: {
                acao: 'AUMENTO_LENTO_HYSTERESIS_POS_HEAP',
                razao: `Heap recente: limitando aumento normal para +${limitado - concorrenciaAnterior} worker; teto ${teto}; sucessos usados ${sucessosUsados}`,
                aumento: limitado - concorrenciaAnterior,
                decisaoOriginal,
                tetoHysteresis: teto
            }
        };
    }

    function ajustarConcorrencia(resultadosRecentes) {
        if (resultadosRecentes.length === 0) return;

        const pressaoBackend = analisarPressaoBackend(resultadosRecentes);

        if (pressaoBackend.javaOutOfMemory > 0) {
            aplicarReducaoCriticaBackend({
                status: 'ERRO_SERVIDOR_JAVA_HEAP',
                categoria: 'JAVA_OUT_OF_MEMORY'
            });
            return;
        }

        if (pressaoBackend.total >= 5 && pressaoBackend.taxaServidor >= 30) {
            const anterior = estado.concorrenciaAtual;
            const novoValor = Math.max(CONFIG.concorrenciaMinima, Math.floor(anterior * CONFIG.fatorReducaoErroServidor));
            const decisao = {
                acao: 'REDUÇÃO_POR_PRESSÃO_BACKEND',
                razao: `Janela recente com ${pressaoBackend.taxaServidor.toFixed(1)}% de 5xx/429/heap`,
                reducao: anterior - novoValor,
                pressaoBackend
            };

            if (registrarAjusteConcorrencia(anterior, novoValor, decisao)) {
                estado.cooldownAte = Math.max(estado.cooldownAte || 0, Date.now() + CONFIG.cooldownErroServidorMs);
            }
            atualizarModal();
            return;
        }

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
            if (backendEmRecuperacao()) {
                console.log(`🧯 Recuperação pós-heap ativa até ${new Date(estado.backendFragilAte).toLocaleTimeString()} | teto: ${estado.tetoRecuperacaoBackend}`);
            }
        }

        encerrarRecuperacaoBackendSeExpirada();

        const ajusteRecuperacao = avaliarAjusteRecuperacaoBackend(concorrenciaAnterior, analise);
        if (ajusteRecuperacao) {
            if (ajusteRecuperacao.novoValor !== concorrenciaAnterior) {
                registrarAjusteConcorrencia(concorrenciaAnterior, ajusteRecuperacao.novoValor, ajusteRecuperacao.decisao, analise);
                if (CONFIG.logDetalhado) {
                    console.log(`🧯 DECISÃO: ${ajusteRecuperacao.decisao.acao}`);
                    console.log(`📝 Razão: ${ajusteRecuperacao.decisao.razao}`);
                    console.log(`⚙️  Workers: ${concorrenciaAnterior} → ${ajusteRecuperacao.novoValor}`);
                    console.log('═══════════════════════════════════════════════════════════');
                    console.log('');
                }
            } else if (CONFIG.logDetalhado) {
                console.log(`🧯 DECISÃO: ${ajusteRecuperacao.decisao.acao}`);
                console.log(`📝 Razão: ${ajusteRecuperacao.decisao.razao}`);
                console.log('═══════════════════════════════════════════════════════════');
                console.log('');
            }
            atualizarModal();
            return;
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

        const limitacaoHysteresis = limitarAumentoPorHysteresisPosHeap(concorrenciaAnterior, novoValor, decisao);
        if (limitacaoHysteresis) {
            novoValor = limitacaoHysteresis.novoValor;
            decisao = limitacaoHysteresis.decisao;
        }

        if (novoValor !== concorrenciaAnterior) {
            registrarAjusteConcorrencia(concorrenciaAnterior, novoValor, decisao, analise);

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

    async function cancelarProcessamento() {
        const confirmarCancelamento = await appConfirm(
            '⚠️ Confirma cancelar o processamento?\n\n' +
            'Os registros já enviados com sucesso não serão revertidos.\n' +
            'O checkpoint PERMANENTE será mantido.\n' +
            'Você pode continuar em outra execução.\n\n' +
            'Cancelar?',
            'Cancelar processamento',
            'alerta',
            'Sim, cancelar',
            'Continuar execução'
        );
        if (confirmarCancelamento) {
            estado.cancelado = true;
            estado.pausado = false;
            if (CONFIG.habilitarCheckpoint) {
                checkpointManager.salvar();
            }
            console.log('🛑 Processamento cancelado');
            console.log(`💾 Checkpoint mantém ${checkpointManager.checkpoint.idsSucesso.length} IDs com sucesso`);
            mostrarMensagemInterna('alerta', 'Processamento cancelado', `Checkpoint mantém ${checkpointManager.checkpoint.idsSucesso.length} IDs com sucesso.`, { persistente: true });
        }
    }

    window.ajustarWorkers = function(delta) {
        const novo = estado.concorrenciaAtual + delta;
        if (novo < CONFIG.concorrenciaMinima) {
            appAlert(`⚠️ Mínimo: ${CONFIG.concorrenciaMinima} workers`, 'Limite de workers', 'alerta');
            return;
        }
        if (novo > CONFIG.concorrenciaMaxima) {
            appAlert(`⚠️ Máximo: ${CONFIG.concorrenciaMaxima} workers`, 'Limite de workers', 'alerta');
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
            appAlert('⚠️ Valores devem ser maiores que 0', 'Configuração inválida', 'alerta');
            return;
        }

        if (min > max) {
            appAlert('⚠️ Mínimo não pode ser maior que máximo', 'Configuração inválida', 'alerta');
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

        appAlert(`✅ Limites aplicados!\n\nMín: ${min}\nMáx: ${max}\nAtual: ${estado.concorrenciaAtual}`, 'Limites aplicados', 'ok');
        atualizarModal();
    };

    async function iniciarReenvioAPI() {
        if (estado.processando) {
            await appAlert('⚠️ Já existe um processamento em andamento!', 'Processamento ativo', 'alerta');
            return;
        }

        if (!TOKEN_GLOBAL && CONFIG.habilitarReloginAutomatico) {
            await tentarRenovarSessaoAutomaticamente('token inicial ausente');
        }

        if (!TOKEN_GLOBAL) {
            const tentarManual = await appConfirm(
                '⚠️ TOKEN NÃO DETECTADO\n\nDeseja fornecê-lo manualmente?',
                'Token necessário',
                'alerta',
                'Informar token',
                'Cancelar'
            );

            if (tentarManual) {
                if (!await solicitarTokenManual()) {
                    await appAlert('❌ Token necessário!', 'Token necessário', 'erro');
                    return;
                }
            } else {
                await appAlert('❌ Token necessário!\n\nDica: Faça uma pesquisa no sistema.', 'Token necessário', 'erro');
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
            `   • Pool de Workers configurado: ${CONFIG.concorrenciaInicial} → ${CONFIG.concorrenciaMaxima}\n` +
            `   • Workers iniciais efetivos: ${obterConcorrenciaInicialEfetiva()}${checkpointManager.getWorkersSeguro()?.valor ? ' (checkpoint seguro)' : ''}\n` +
            `   • Hysteresis pós-heap: +${CONFIG.incrementoRecuperacaoBackend} worker após ${CONFIG.minimoSucessosParaSubirPosHeap} sucessos\n` +
            `   • Auto-tuning Inteligente: ${CONFIG.ajusteAutomatico ? 'ATIVO' : 'DESATIVADO'}\n` +
            `   • Retry: ${CONFIG.maxRetentativas}x\n` +
            `   • Relogin automático: ${CONFIG.habilitarReloginAutomatico ? 'ATIVO (SSO OAuth implicit)' : 'DESATIVADO'}\n` +
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

        if (!await appConfirm(mensagemInicial, 'Iniciar reenvio via API', 'info', 'Iniciar', 'Cancelar')) {
            return;
        }

        if (CONFIG.habilitarLoginAutomaticoComCredenciais && CONFIG.solicitarCredenciaisNoInicio) {
            const creds = await obterCredenciaisLogin('Para execução longa set-and-forget, informe credenciais para re-login automático caso a sessão expire.');
            if (!creds) {
                const continuarSemCredenciais = await appConfirm(
                    '⚠️ Sem credenciais em memória, o script não conseguirá re-logar automaticamente se a sessão expirar.\n\nContinuar mesmo assim?',
                    'Continuar sem credenciais?',
                    'alerta',
                    'Continuar',
                    'Cancelar'
                );
                if (!continuarSemCredenciais) return;
            } else {
                prepararPopupReloginAntecipado();
            }
        }

        estado = criarEstadoInicial(obterConcorrenciaInicialEfetiva());
        estado.processando = true;
        estado.iniciado = Date.now();

        criarModal();
        iniciarWatchdogSessao();
        console.log(`🚀 Iniciando reenvio via API Direct v${VERSAO}...`);
        console.log(`🏊 Pool de Workers Dinâmico habilitado`);
        console.log(`✨ Auto-tuning inteligente com análise de latência`);
        console.log(`📋 Status a buscar: ${statusTexto}`);
        console.log(`💾 Checkpoint permanente: ${resumo ? resumo.idsSucesso : 0} IDs com sucesso`);
        if (estado.workersSeguroCheckpointInicial) {
            console.log(`🛡️ Workers seguro do checkpoint aplicado: ${estado.workersSeguroCheckpointInicial} (inicial efetivo: ${estado.concorrenciaAtual})`);
        }
        if (estado.modoRecuperacaoBackend) {
            console.log(`🧯 Recuperação pós-heap persistida ativa até ${new Date(estado.backendFragilAte).toLocaleTimeString()} | teto: ${estado.tetoRecuperacaoBackend}`);
        }
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
                await appAlert(msg, 'Nenhum registro para processar', 'alerta');
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
            await appAlert(`❌ Erro: ${erro.message}`, 'Erro no processamento', 'erro');
            estado.processando = false;
            pararWatchdogSessao();
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
        console.log(`    ✅ Sucesso total: ${estado.totalSucesso}`);
        console.log(`    ✅ Confirmado: ${estado.statusDetalhado?.sucessoConfirmado || 0}`);
        console.log(`    🟦 Já existia/duplicado: ${estado.statusDetalhado?.jaExistia || 0}`);
        console.log(`    🟨 Aceito pendente: ${estado.statusDetalhado?.aceitoPendente || 0}`);
        console.log(`    🟧 Indeterminado: ${estado.statusDetalhado?.indeterminado || 0}`);
        console.log(`    ☕ Java heap/OutOfMemory: ${estado.statusDetalhado?.javaOutOfMemory || 0}`);
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
        console.log(`    🛡️ Workers seguro: ${resumo.workersSeguro?.valor || 'não definido'}`);
        if (resumo.backendFragil?.ultimoHeapEm) {
            console.log(`    🧯 Último heap: ${new Date(resumo.backendFragil.ultimoHeapEm).toLocaleString()} | workers: ${resumo.backendFragil.ultimoWorkersComHeap || '-'} | teto recuperação: ${resumo.backendFragil.tetoRecuperacao || '-'}`);
        }

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
                `  ✅ Sucesso total: ${estado.totalSucesso}\n` +
                `  ✅ Confirmado: ${estado.statusDetalhado?.sucessoConfirmado || 0}\n` +
                `  🟦 Já existia/duplicado: ${estado.statusDetalhado?.jaExistia || 0}\n` +
                `  🟨 Aceito pendente: ${estado.statusDetalhado?.aceitoPendente || 0}\n` +
                `  🟧 Indeterminado: ${estado.statusDetalhado?.indeterminado || 0}\n` +
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
                `  📊 Total execuções: ${resumo.totalExecucoes}\n` +
                `  🛡️ Workers seguro: ${resumo.workersSeguro?.valor || 'não definido'}\n`;

            if (CONFIG.habilitarFiltroData) {
                textoCompleto += `\nPERÍODO FILTRADO:\n` +
                                `  📅 ${CONFIG.dataInicio} até ${CONFIG.dataFim}\n`;
            }

            console.log(textoCompleto);

            if (CONFIG.exportarCSVAutomaticamente) {
                exportarCSV();
                mostrarMensagemInterna('ok', 'Relatório CSV exportado', 'O CSV final foi exportado automaticamente. Use o botão “Exportar CSV” para baixar novamente, se necessário.', { persistente: true });
            } else {
                mostrarMensagemInterna('info', 'Processamento finalizado', 'O processamento terminou. Use o botão “Exportar CSV” para baixar o relatório.', { persistente: true });
            }
            mostrarMensagemInterna(cancelado ? 'alerta' : 'ok', cancelado ? 'Processamento cancelado' : 'Reenvio finalizado', textoCompleto, { persistente: true });

            estado.processando = false;
            pararWatchdogSessao();
            if (CONFIG.preservarCredenciaisAposFim === false) limparCredenciaisLoginMemoria();

            if (!CONFIG.manterModalAbertoAoFinal) {
                fecharModal();
            }
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
                                <strong>✅ Confirmado:</strong>
                                <span id="apiSucessoConfirmado" style="float: right; color: green; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>🟦 Já existia:</strong>
                                <span id="apiJaExistia" style="float: right; color: #1976d2; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>🟨 Pendente:</strong>
                                <span id="apiAceitoPendente" style="float: right; color: #f9a825; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>🟧 Indeterm.:</strong>
                                <span id="apiIndeterminado" style="float: right; color: #ef6c00; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>🧩 Negócio/Val.:</strong>
                                <span id="apiErroNegocio" style="float: right; color: #c62828; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>☕ Heap Java:</strong>
                                <span id="apiJavaHeap" style="float: right; color: #6d4c41; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>🌐 Rede/Servidor:</strong>
                                <span id="apiErroTransporte" style="float: right; color: #ad1457; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>🔐 Sessão/Login:</strong>
                                <span id="apiSessao" style="float: right; color: #5e35b1; font-weight: bold;">0</span>
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
                            <div>
                                <strong>🛡️ Worker seguro:</strong>
                                <span id="apiWorkersSeguro" style="float: right; color: #2e7d32; font-weight: bold;">-</span>
                            </div>
                            <div>
                                <strong>🧯 Pós-heap:</strong>
                                <span id="apiRecuperacaoBackend" style="float: right; color: #bf360c; font-weight: bold;">-</span>
                            </div>
                            <div>
                                <strong>✅ Sucessos pós-heap:</strong>
                                <span id="apiSucessosDesdeHeap" style="float: right; color: #455a64; font-weight: bold;">0</span>
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


                    <div id="apiMensagensPainel" style="background: #f8fbff; border: 1px solid #bbdefb; border-left: 4px solid #2196f3; padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 13px;">
                        <div style="font-weight: bold; color: #1565c0; margin-bottom: 8px;">📬 Mensagens / ações do script</div>
                        <div id="apiMensagensLista" style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow: auto;">
                            <div style="background: #e3f2fd; border-left: 4px solid #1565c0; border-radius: 5px; padding: 8px; color: #333;">
                                As mensagens aparecerão aqui sem usar alert/confirm/prompt nativos do navegador.
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
                        <button onclick="window.exportarCSVManual && window.exportarCSVManual()"
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
        const cooldownRestante = estado.cooldownAte && Date.now() < estado.cooldownAte
            ? Math.ceil((estado.cooldownAte - Date.now()) / 1000)
            : 0;

        const recuperacaoRestante = estado.backendFragilAte && Date.now() < estado.backendFragilAte
            ? Math.ceil((estado.backendFragilAte - Date.now()) / 1000)
            : 0;
        const workersSeguroAtual = checkpointManager.getWorkersSeguro()?.valor || estado.ultimoWorkersSeguroRegistrado || '-';

        const elementos = {
            apiStatus: status || (estado.relogando ? '🔐 Renovando sessão/login...' : (cooldownRestante > 0 ? `🧊 Cooldown backend: ${cooldownRestante}s` : (estado.pausado ? '⏸️ PAUSADO' : 'Processando...'))),
            apiPaginas: `${estado.paginaAtual}/${estado.totalPaginas || '?'}`,
            apiBuscados: estado.totalBuscados,
            apiProcessados: estado.totalProcessados,
            apiSucesso: estado.totalSucesso,
            apiErros: estado.totalErro,
            apiTimeouts: estado.totalTimeout,
            apiSucessoConfirmado: estado.statusDetalhado?.sucessoConfirmado || 0,
            apiJaExistia: estado.statusDetalhado?.jaExistia || 0,
            apiAceitoPendente: estado.statusDetalhado?.aceitoPendente || 0,
            apiIndeterminado: estado.statusDetalhado?.indeterminado || 0,
            apiErroNegocio: (estado.statusDetalhado?.erroNegocio || 0) + (estado.statusDetalhado?.erroValidacao || 0) + (estado.statusDetalhado?.conflito || 0) + (estado.statusDetalhado?.naoEncontrado || 0),
            apiJavaHeap: estado.statusDetalhado?.javaOutOfMemory || 0,
            apiErroTransporte: (estado.statusDetalhado?.erroServidor || 0) + (estado.statusDetalhado?.javaOutOfMemory || 0) + (estado.statusDetalhado?.erroRede || 0) + (estado.statusDetalhado?.erroHttp || 0) + (estado.statusDetalhado?.erroAuth || 0) + (estado.statusDetalhado?.rateLimit || 0),
            apiSessao: `${estado.statusDetalhado?.sessaoExpirada || 0}/${estado.statusDetalhado?.reloginSucesso || 0}/${estado.statusDetalhado?.reloginFalha || 0}${estado.sessaoBloqueada ? ' BLOQ' : ''}`,
            apiPulados: estado.totalPulados,
            apiRetries: estado.totalRetentativas,
            apiWorkers: estado.concorrenciaAtual,
            apiWorkersSeguro: workersSeguroAtual,
            apiRecuperacaoBackend: backendEmRecuperacao() ? `ativo ${recuperacaoRestante}s | teto ${estado.tetoRecuperacaoBackend || '-'}` : '-',
            apiSucessosDesdeHeap: `${estado.sucessosDesdeHeap || 0}/${CONFIG.minimoSucessosParaSubirPosHeap}`,
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

    function sanearCSV(valor, limite = 5000) {
        return valorParaTexto(valor)
            .replace(/;/g, ',')
            .replace(/\r?\n/g, ' ')
            .slice(0, limite);
    }

    function exportarCSV() {
        const linhas = [
            [
                'ID', 'Nome Paciente', 'CNS', 'CPF', 'Vacina', 'Status', 'Categoria', 'Severidade', 'Conclusivo', 'Retryable',
                'HTTP Status', 'Tentativa', 'Latência (ms)', 'Mensagem', 'Payload Bruto', 'Timestamp'
            ].join(';')
        ];

        estado.resultados.forEach(r => {
            linhas.push([
                r.id,
                sanearCSV(r.nomePaciente || 'N/A', 300),
                sanearCSV(r.cns || 'N/A', 80),
                sanearCSV(r.cpf || 'N/A', 80),
                r.vacina,
                r.status,
                r.categoria || '',
                r.severidade || '',
                r.conclusivo === true ? 'SIM' : 'NAO',
                r.retryable === true ? 'SIM' : 'NAO',
                r.statusCode,
                r.tentativa,
                r.latencia || '-',
                sanearCSV(r.mensagem || r.erro || '', 2000),
                sanearCSV(r.payloadBruto || '', 5000),
                r.timestamp
            ].join(';'));
        });

        const resumo = checkpointManager.getResumo();
        const analise = analisarPerformance();
        const detalhes = estado.statusDetalhado || criarResumoStatusDetalhado();

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
        linhas.push(`Campos Paciente no CSV;Nome Paciente + CNS + CPF, quando retornados pela API`);
        linhas.push(`Sucesso Total (Confirmado + Já Existia);${estado.totalSucesso}`);
        linhas.push(`Sucesso Confirmado;${detalhes.sucessoConfirmado || 0}`);
        linhas.push(`Já Existia / Duplicado;${detalhes.jaExistia || 0}`);
        linhas.push(`Aceito Pendente;${detalhes.aceitoPendente || 0}`);
        linhas.push(`Indeterminado;${detalhes.indeterminado || 0}`);
        linhas.push(`Erro Validação;${detalhes.erroValidacao || 0}`);
        linhas.push(`Erro Negócio;${detalhes.erroNegocio || 0}`);
        linhas.push(`Conflito;${detalhes.conflito || 0}`);
        linhas.push(`Não Encontrado;${detalhes.naoEncontrado || 0}`);
        linhas.push(`Erro Auth;${detalhes.erroAuth || 0}`);
        linhas.push(`Sessão Expirada/Login;${detalhes.sessaoExpirada || 0}`);
        linhas.push(`Relogin Sucesso;${detalhes.reloginSucesso || 0}`);
        linhas.push(`Relogin Falha;${detalhes.reloginFalha || 0}`);
        linhas.push(`Renovação Preventiva;${detalhes.renovacaoPreventiva || 0}`);
        linhas.push(`Relogin Bloqueado;${detalhes.reloginBloqueado || 0}`);
        linhas.push(`Token Capturado Em;${TOKEN_CAPTURADO_EM ? new Date(TOKEN_CAPTURADO_EM).toLocaleString() : '-'}`);
        linhas.push(`Token Expira Em;${TOKEN_EXPIRA_EM ? new Date(TOKEN_EXPIRA_EM).toLocaleString() : '-'}`);
        linhas.push(`Rate Limit;${detalhes.rateLimit || 0}`);
        linhas.push(`Java Heap / OutOfMemory;${detalhes.javaOutOfMemory || 0}`);
        linhas.push(`Erro Servidor;${detalhes.erroServidor || 0}`);
        linhas.push(`Erro Rede;${detalhes.erroRede || 0}`);
        linhas.push(`Erro HTTP;${detalhes.erroHttp || 0}`);
        linhas.push(`Timeouts;${estado.totalTimeout}`);
        linhas.push(`Erros Agregados;${estado.totalErro}`);
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
        linhas.push(`Workers Seguro;${resumo.workersSeguro?.valor || ''}`);
        linhas.push(`Workers Seguro Atualizado Em;${resumo.workersSeguro?.atualizadoEm ? new Date(resumo.workersSeguro.atualizadoEm).toLocaleString() : ''}`);
        linhas.push(`Último Heap Backend;${resumo.backendFragil?.ultimoHeapEm ? new Date(resumo.backendFragil.ultimoHeapEm).toLocaleString() : ''}`);
        linhas.push(`Workers no Último Heap;${resumo.backendFragil?.ultimoWorkersComHeap || ''}`);
        linhas.push(`Teto Recuperação Pós-Heap;${resumo.backendFragil?.tetoRecuperacao || ''}`);
        linhas.push('Observação;Checkpoint grava apenas SUCESSO_CONFIRMADO ou JA_EXISTIA como sucesso permanente; workers seguro é gravado só após janela estável sem falhas críticas');

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
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
            try { link.remove(); } catch (e) {}
        }, 1000);

        console.log('💾 CSV exportado com classificação detalhada!');
        mostrarMensagemInterna('ok', 'CSV exportado', `Arquivo gerado: ${link.download}`, { persistente: false });
    }

    window.exportarCSVManual = exportarCSV;

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

        document.getElementById('btnSalvarConfig').onclick = async () => {
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
                await appAlert('⚠️ Timeout muito baixo! Mínimo recomendado: 5000ms (5s)', 'Timeout inválido', 'alerta');
                return;
            }

            if (CONFIG.timeoutRequisicao > 120000) {
                if (!await appConfirm(
                    '⚠️ Timeout muito alto!\n\n' +
                    `Timeout configurado: ${CONFIG.timeoutRequisicao}ms (${CONFIG.timeoutRequisicao/1000}s)\n\n` +
                    'Timeouts altos podem travar o processamento se houver problemas na rede.\n\n' +
                    'Continuar mesmo assim?',
                    'Timeout alto',
                    'alerta',
                    'Continuar',
                    'Revisar'
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
                    await appAlert('⚠️ Data de início não pode ser maior que data de fim!', 'Período inválido', 'alerta');
                    return;
                }

                const hoje = new Date();
                hoje.setHours(0, 0, 0, 0);

                if (fim > hoje) {
                    if (!await appConfirm(
                        '⚠️ Data de fim está no futuro!\n\n' +
                        `Data fim: ${CONFIG.dataFim}\n` +
                        `Hoje: ${hoje.toISOString().split('T')[0]}\n\n` +
                        'Continuar mesmo assim?',
                        'Data futura',
                        'alerta',
                        'Continuar',
                        'Revisar'
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

            await appAlert(msg, 'Configurações salvas', 'ok');
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

    async function gerenciarCheckpoint() {
        const resumo = checkpointManager.getResumo();

        if (!resumo) {
            await appAlert('ℹ️ Nenhum checkpoint encontrado', 'Checkpoint', 'info');
            return;
        }

        const historico = checkpointManager.getHistorico();
        let mensagem = '💾 CHECKPOINT PERMANENTE\n\n' +
                      `Data: ${resumo.dataCheckpoint.toLocaleString()}\n` +
                      `IDs com SUCESSO: ${resumo.idsSucesso}\n` +
                      `Execuções: ${resumo.totalExecucoes}\n` +
                      `Workers seguro: ${resumo.workersSeguro?.valor || 'não definido'}\n` +
                      `${resumo.workersSeguro?.atualizadoEm ? `Workers seguro atualizado: ${new Date(resumo.workersSeguro.atualizadoEm).toLocaleString()}\n` : ''}` +
                      `${resumo.backendFragil?.ultimoHeapEm ? `Último heap: ${new Date(resumo.backendFragil.ultimoHeapEm).toLocaleString()} com ${resumo.backendFragil.ultimoWorkersComHeap || '-'} workers\nTeto recuperação: ${resumo.backendFragil.tetoRecuperacao || '-'}\n` : ''}` +
                      `\n`;

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
            '🛡️ Workers seguro é reutilizado como concorrência inicial/teto conservador\n' +
            '🔄 Erros/timeouts tentados novamente\n\n' +
            'Deseja LIMPAR o checkpoint permanente?';

        if (await appConfirm(mensagem, 'Checkpoint permanente', 'alerta', 'Limpar checkpoint', 'Manter')) {
            await checkpointManager.limpar();
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
        btnToken.onclick = async () => {
            if (TOKEN_GLOBAL) {
                const copiar = await appConfirm(`🔑 TOKEN:\n\n${TOKEN_GLOBAL}\n\n\nCopiar?`, 'Token capturado', 'info', 'Copiar', 'Fechar');
                if (copiar) {
                    await navigator.clipboard.writeText(TOKEN_GLOBAL);
                    await appAlert('✅ Token copiado!', 'Token', 'ok');
                }
            } else {
                await solicitarTokenManual();
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
        btnCheckpoint.onclick = () => { gerenciarCheckpoint(); };

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

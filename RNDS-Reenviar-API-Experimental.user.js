// ==UserScript==
// @name         SPRNDS - Reenviar API Experimental v1.0
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  ⚡ Versão experimental usando API de marcação de status para reenvio
// @author       Renato Krebs Rosa
// @match        *://*/rnds/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar-API-Experimental.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar-API-Experimental.user.js
// @supportURL   https://github.com/RenatoKR/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // ⚙️ CONFIGURAÇÕES
    // ============================================
    const CONFIG = {
        diasRetroagir: 30, // Quantos dias para trás buscar erros
        concorrenciaMarcacao: 10, // Workers paralelos para marcação
        pausaEntreLotes: 100, // ms entre lotes
        timeoutRequisicao: 30000, // 30s timeout
        habilitarLogs: true
    };

    // ============================================
    // 📊 ESTADO GLOBAL
    // ============================================
    let estado = {
        processando: false,
        cancelado: false,
        iniciado: null,
        totalErros: 0,
        totalMarcados: 0,
        totalFalhas: 0,
        erros: []
    };

    let TOKEN_GLOBAL = null;

    // ============================================
    // 🔑 CAPTURA DE TOKEN (mesmo do script original)
    // ============================================

    function interceptarXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
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
        const token = localStorage.getItem('RNDS_TOKEN');
        if (token && token.length > 20) {
            TOKEN_GLOBAL = token;
            console.log('🔑 Token encontrado em storage');
            atualizarBotaoToken(true);
            return true;
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
        const botaoToken = document.getElementById('btnVerTokenExp');
        if (botaoToken) {
            const icon = botaoToken.querySelector('span.icon-emoji');
            if (icon) {
                icon.style.color = capturado ? '#4caf50' : '#ff9800';
                botaoToken.title = capturado ? 'Token capturado!' : 'Token não capturado';
            }
        }
    }

    // ============================================
    // 🌐 NOVAS APIs - DESCOBERTAS NO HAR
    // ============================================

    /**
     * Lista todos os erros/inconsistências de vacinas em um período
     */
    async function listarInconsistencias(dataInicio, dataFim) {
        const url = `/rnds/api/mapped-error/inconsistency-errors-vaccine?initialDate=${dataInicio}&finalDate=${dataFim}`;

        if (CONFIG.habilitarLogs) {
            console.log(`🔍 Buscando inconsistências...`);
            console.log(`   📅 Período: ${dataInicio} até ${dataFim}`);
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Authorization': `Bearer ${TOKEN_GLOBAL}`,
                    'accept-language': 'pt-BR'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const dados = await response.json();

            if (CONFIG.habilitarLogs) {
                console.log(`   ✅ ${dados.length || 0} inconsistências encontradas`);
            }

            return dados || [];

        } catch (erro) {
            console.error(`❌ Erro ao listar inconsistências:`, erro);
            throw erro;
        }
    }

    /**
     * Marca uma vacina para reenvio (status = 0)
     */
    async function marcarParaReenvio(uuid) {
        const url = `/rnds/api/mapped-error/update-vaccine-with-send-status-zero/${uuid}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeoutRequisicao);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Authorization': `Bearer ${TOKEN_GLOBAL}`,
                    'accept-language': 'pt-BR'
                },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return {
                uuid: uuid,
                sucesso: true,
                status: response.status
            };

        } catch (erro) {
            return {
                uuid: uuid,
                sucesso: false,
                erro: erro.message
            };
        }
    }

    // ============================================
    // ⚡ PROCESSAMENTO EM POOL
    // ============================================

    async function processarComPool(erros) {
        const inicio = Date.now();
        const resultados = [];
        let proximoIndice = 0;
        const totalErros = erros.length;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`🏊 POOL DE WORKERS: ${CONFIG.concorrenciaMarcacao} workers`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        async function worker(workerId) {
            let processados = 0;
            let sucessos = 0;
            let falhas = 0;

            while (true) {
                if (estado.cancelado) {
                    break;
                }

                const indice = proximoIndice++;

                if (indice >= totalErros) {
                    break;
                }

                const erro = erros[indice];
                const resultado = await marcarParaReenvio(erro.id || erro.uuid);

                processados++;

                if (resultado.sucesso) {
                    sucessos++;
                    estado.totalMarcados++;
                } else {
                    falhas++;
                    estado.totalFalhas++;
                }

                resultados.push(resultado);

                if ((indice + 1) % 10 === 0) {
                    atualizarModal();
                }

                await new Promise(r => setTimeout(r, CONFIG.pausaEntreLotes));
            }

            console.log(`🟠 Worker #${workerId}: ${processados} processados (✅ ${sucessos} | ❌ ${falhas})`);
        }

        const workersPromises = [];
        for (let i = 0; i < CONFIG.concorrenciaMarcacao; i++) {
            workersPromises.push(worker(i + 1));
        }

        await Promise.all(workersPromises);

        const tempoTotal = Date.now() - inicio;
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`✅ POOL FINALIZADO: ${(tempoTotal / 1000).toFixed(2)}s`);
        console.log(`⚡ Velocidade: ${((resultados.length / (tempoTotal / 1000)) * 60).toFixed(2)} reg/min`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        return resultados;
    }

    // ============================================
    // 🚀 FLUXO PRINCIPAL
    // ============================================

    async function iniciarReenvioExperimental() {
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

        const mensagem =
            '⚡ VERSÃO EXPERIMENTAL\n\n' +
            '🆕 NOVA ABORDAGEM:\n' +
            '  1️⃣ Lista erros via API de inconsistências\n' +
            '  2️⃣ Marca registros com status 0 (pendente)\n' +
            '  3️⃣ Sistema automático faz o reenvio\n\n' +
            '⚙️ CONFIGURAÇÃO:\n' +
            `  • Período: últimos ${CONFIG.diasRetroagir} dias\n` +
            `  • Workers: ${CONFIG.concorrenciaMarcacao}\n\n` +
            '⚡ VANTAGENS:\n' +
            '  ✅ Muito mais rápido\n' +
            '  ✅ Mais confiável\n' +
            '  ✅ Deixa o sistema fazer o trabalho\n\n' +
            'Iniciar?';

        if (!confirm(mensagem)) {
            return;
        }

        estado = {
            processando: true,
            cancelado: false,
            iniciado: Date.now(),
            totalErros: 0,
            totalMarcados: 0,
            totalFalhas: 0,
            erros: []
        };

        criarModal();
        console.log('🚀 Iniciando reenvio experimental v1.0...');

        try {
            atualizarModal('Buscando inconsistências...');

            // Calcula período
            const dataFim = new Date();
            const dataInicio = new Date();
            dataInicio.setDate(dataInicio.getDate() - CONFIG.diasRetroagir);

            const dataInicioStr = dataInicio.toISOString().split('T')[0] + 'T00:00:00';
            const dataFimStr = dataFim.toISOString().split('T')[0] + 'T23:59:59';

            // ETAPA 1: Buscar erros
            estado.erros = await listarInconsistencias(dataInicioStr, dataFimStr);
            estado.totalErros = estado.erros.length;

            if (estado.cancelado) {
                fecharModal();
                estado.processando = false;
                return;
            }

            if (estado.totalErros === 0) {
                alert(
                    '✅ Nenhum erro encontrado!\n\n' +
                    `Período: últimos ${CONFIG.diasRetroagir} dias\n` +
                    'Todos os registros estão corretos.'
                );
                fecharModal();
                estado.processando = false;
                return;
            }

            console.log(`📊 Total de erros encontrados: ${estado.totalErros}`);
            console.log('');

            atualizarModal('Marcando para reenvio...');

            // ETAPA 2: Marcar todos para reenvio
            await processarComPool(estado.erros);

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
        const taxaSucesso = estado.totalErros > 0
            ? ((estado.totalMarcados / estado.totalErros) * 100).toFixed(1)
            : 0;

        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(cancelado ? '⚠️ PROCESSAMENTO CANCELADO!' : '🏁 PROCESSAMENTO FINALIZADO!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`📊 Total de erros encontrados: ${estado.totalErros}`);
        console.log(`✅ Marcados para reenvio: ${estado.totalMarcados}`);
        console.log(`❌ Falhas na marcação: ${estado.totalFalhas}`);
        console.log(`⏱️ Tempo total: ${tempoTotal}s`);
        console.log(`📊 Taxa de sucesso: ${taxaSucesso}%`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
        console.log('💡 Os registros marcados serão reenviados automaticamente');
        console.log('💡 pelo sistema de sincronização do E-SUS.');
        console.log('');

        atualizarModal(cancelado ? 'Cancelado!' : 'Finalizado!', true);

        setTimeout(() => {
            const mensagem = cancelado
                ? `⚠️ PROCESSAMENTO CANCELADO\n\n`
                : `🎊 MARCAÇÃO FINALIZADA!\n\n`;

            const textoCompleto = mensagem +
                `📊 Erros encontrados: ${estado.totalErros}\n` +
                `✅ Marcados para reenvio: ${estado.totalMarcados}\n` +
                `❌ Falhas: ${estado.totalFalhas}\n` +
                `⏱️ Tempo: ${tempoTotal}s\n` +
                `📊 Taxa: ${taxaSucesso}%\n\n` +
                `💡 O sistema automático do E-SUS irá\n` +
                `reenviar os registros marcados.\n\n` +
                `Aguarde alguns minutos e verifique o dashboard.`;

            alert(textoCompleto);

            fecharModal();
            estado.processando = false;
        }, 500);
    }

    function cancelarProcessamento() {
        if (confirm('⚠️ Confirma cancelar o processamento?')) {
            estado.cancelado = true;
            console.log('🛑 Processamento cancelado');
        }
    }

    // ============================================
    // 🎨 INTERFACE
    // ============================================

    function criarModal() {
        if (document.getElementById('modalExp')) return;

        const modal = document.createElement('div');
        modal.id = 'modalExp';
        modal.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(0,0,0,0.7); z-index: 999999; display: flex;
                        align-items: center; justify-content: center;">
                <div style="background: white; padding: 30px; border-radius: 8px;
                            min-width: 550px; max-width: 700px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <h2 style="margin: 0 0 20px 0; color: #ff9800; text-align: center;">
                        ⚡ API Experimental v1.0
                    </h2>

                    <div id="statusExp" style="font-size: 14px; color: #666; margin-bottom: 15px; text-align: center; font-weight: bold;">
                        Iniciando...
                    </div>

                    <div style="background: #f5f5f5; padding: 20px; border-radius: 4px; margin-bottom: 20px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 13px;">
                            <div>
                                <strong>📊 Erros Encontrados:</strong>
                                <span id="expErros" style="float: right; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>✅ Marcados:</strong>
                                <span id="expMarcados" style="float: right; color: green; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>❌ Falhas:</strong>
                                <span id="expFalhas" style="float: right; color: red; font-weight: bold;">0</span>
                            </div>
                            <div>
                                <strong>⏱️ Tempo:</strong>
                                <span id="expTempo" style="float: right; font-weight: bold;">0s</span>
                            </div>
                        </div>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
                            <span>Progresso</span>
                            <span id="expProgresso">0%</span>
                        </div>
                        <div style="background: #e0e0e0; height: 30px; border-radius: 4px; overflow: hidden;">
                            <div id="expBarraProgresso" style="background: linear-gradient(90deg, #ff9800, #f57c00);
                                 height: 100%; width: 0%; transition: width 0.3s; display: flex; align-items: center;
                                 justify-content: center; color: white; font-weight: bold; font-size: 14px;">
                            </div>
                        </div>
                    </div>

                    <div style="background: #e3f2fd; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                        <div style="font-size: 12px; color: #1565c0; text-align: center;">
                            <strong>💡 Sistema Automático</strong><br>
                            Os registros marcados serão reenviados<br>
                            automaticamente pelo sistema de sincronização
                        </div>
                    </div>

                    <div id="expBotoesControle" style="display: flex; gap: 10px; justify-content: center;">
                        <button onclick="window.cancelarExp()"
                                style="padding: 10px 20px; background: #f44336; color: white; border: none;
                                       border-radius: 4px; cursor: pointer; font-weight: bold;">
                            🛑 Cancelar
                        </button>
                    </div>

                    <div id="expBotoesFinais" style="display: none; margin-top: 20px; text-align: center;">
                        <button onclick="document.getElementById('modalExp').remove()"
                                style="padding: 10px 20px; background: #666; color: white; border: none;
                                       border-radius: 4px; cursor: pointer;">
                            ✖️ Fechar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        window.cancelarExp = cancelarProcessamento;
    }

    function atualizarModal(status, finalizado = false) {
        const progresso = estado.totalErros > 0
            ? Math.floor(((estado.totalMarcados + estado.totalFalhas) / estado.totalErros) * 100)
            : 0;
        const tempoDecorrido = Math.floor((Date.now() - estado.iniciado) / 1000);

        const elementos = {
            statusExp: status || 'Processando...',
            expErros: estado.totalErros,
            expMarcados: estado.totalMarcados,
            expFalhas: estado.totalFalhas,
            expTempo: `${tempoDecorrido}s`,
            expProgresso: `${progresso}%`
        };

        Object.entries(elementos).forEach(([id, valor]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = valor;
        });

        const barra = document.getElementById('expBarraProgresso');
        if (barra) {
            barra.style.width = `${progresso}%`;
            barra.textContent = `${progresso}%`;
        }

        if (finalizado) {
            const controles = document.getElementById('expBotoesControle');
            const finais = document.getElementById('expBotoesFinais');
            if (controles) controles.style.display = 'none';
            if (finais) finais.style.display = 'block';
        }
    }

    function fecharModal() {
        const modal = document.getElementById('modalExp');
        if (modal) modal.remove();
    }

    // ============================================
    // ⚙️ CONFIGURAÇÕES
    // ============================================

    function abrirConfiguracoesExp() {
        const modalConfig = document.createElement('div');
        modalConfig.id = 'modalConfigExp';
        modalConfig.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                        background: rgba(0,0,0,0.7); z-index: 999999; display: flex;
                        align-items: center; justify-content: center;">
                <div style="background: white; padding: 30px; border-radius: 8px;
                            width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <h2 style="margin: 0 0 20px 0; color: #ff9800;">⚙️ Configurações Experimentais</h2>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            📅 Dias para retroagir:
                        </label>
                        <input type="number" id="cfgDiasRetroagir" value="${CONFIG.diasRetroagir}"
                               min="1" max="365"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <small style="color: #666;">Buscar erros dos últimos X dias</small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            ⚡ Workers (concorrência):
                        </label>
                        <input type="number" id="cfgConcorrencia" value="${CONFIG.concorrenciaMarcacao}"
                               min="1" max="50"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <small style="color: #666;">Requisições paralelas para marcação</small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                            ⏱️ Timeout (ms):
                        </label>
                        <input type="number" id="cfgTimeout" value="${CONFIG.timeoutRequisicao}"
                               min="5000" max="60000" step="1000"
                               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <small style="color: #666;">Timeout por requisição (${CONFIG.timeoutRequisicao/1000}s)</small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: flex; align-items: center; cursor: pointer;">
                            <input type="checkbox" id="cfgLogs" ${CONFIG.habilitarLogs ? 'checked' : ''}
                                   style="margin-right: 10px; width: 20px; height: 20px; cursor: pointer;">
                            <span style="font-weight: bold;">📝 Logs detalhados no console</span>
                        </label>
                    </div>

                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button onclick="document.getElementById('modalConfigExp').remove()"
                                style="padding: 10px 20px; background: #666; color: white; border: none;
                                       border-radius: 4px; cursor: pointer;">
                            Cancelar
                        </button>
                        <button id="btnSalvarConfigExp"
                                style="padding: 10px 20px; background: #4caf50; color: white; border: none;
                                       border-radius: 4px; cursor: pointer; font-weight: bold;">
                            💾 Salvar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalConfig);

        document.getElementById('btnSalvarConfigExp').onclick = () => {
            CONFIG.diasRetroagir = parseInt(document.getElementById('cfgDiasRetroagir').value);
            CONFIG.concorrenciaMarcacao = parseInt(document.getElementById('cfgConcorrencia').value);
            CONFIG.timeoutRequisicao = parseInt(document.getElementById('cfgTimeout').value);
            CONFIG.habilitarLogs = document.getElementById('cfgLogs').checked;

            localStorage.setItem('RNDS_CONFIG_EXP', JSON.stringify(CONFIG));

            alert(
                '✅ Configurações salvas!\n\n' +
                `📅 Dias: ${CONFIG.diasRetroagir}\n` +
                `⚡ Workers: ${CONFIG.concorrenciaMarcacao}\n` +
                `⏱️ Timeout: ${CONFIG.timeoutRequisicao/1000}s`
            );

            document.getElementById('modalConfigExp').remove();
            console.log('⚙️ Novas configurações:', CONFIG);
        };
    }

    function carregarConfiguracoes() {
        const configSalva = localStorage.getItem('RNDS_CONFIG_EXP');
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
        btnToken.id = 'btnVerTokenExp';
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

        const btnConfig = document.createElement('button');
        btnConfig.id = 'btnConfigExp';
        btnConfig.className = 'nab-focus-indicator nab-icon-button nab-button-base';
        btnConfig.setAttribute('nab-icon-button', '');
        btnConfig.title = 'Configurações Experimentais';
        btnConfig.innerHTML = `
            <span class="nab-button-wrapper">
                <span class="icon-emoji" style="font-size: 20px; color: #9c27b0;">⚙️</span>
            </span>
        `;
        btnConfig.onclick = abrirConfiguracoesExp;

        const btnReenviar = document.createElement('button');
        btnReenviar.id = 'btnReenviarExp';
        btnReenviar.className = 'nab-focus-indicator nab-icon-button nab-button-base';
        btnReenviar.setAttribute('nab-icon-button', '');
        btnReenviar.title = '⚡ Reenvio Experimental';
        btnReenviar.innerHTML = `
            <span class="nab-button-wrapper">
                <span class="icon-emoji" style="font-size: 20px; color: #ff9800;">⚡</span>
            </span>
        `;
        btnReenviar.onclick = iniciarReenvioExperimental;

        const btnGlobal = toolbar.querySelector('button[nab-icon-button]');
        if (btnGlobal) {
            toolbar.insertBefore(divider, btnGlobal);
            toolbar.insertBefore(btnToken, btnGlobal);
            toolbar.insertBefore(btnConfig, btnGlobal);
            toolbar.insertBefore(btnReenviar, btnGlobal);
        }

        console.log('✅ Botões experimentais adicionados!');
        atualizarBotaoToken(!!TOKEN_GLOBAL);
    }

    // ============================================
    // 🚀 INICIALIZAÇÃO
    // ============================================

    function inicializar() {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('⚡ SPRNDS - API Experimental v1.0');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🆕 NOVA ABORDAGEM:');
        console.log('  1. Lista erros via API de inconsistências');
        console.log('  2. Marca registros com status 0 (pendente)');
        console.log('  3. Sistema automático faz o reenvio');
        console.log('');
        console.log('⚡ VANTAGENS:');
        console.log('  ✅ Muito mais rápido que reenvio um por um');
        console.log('  ✅ Mais confiável - usa sistema nativo');
        console.log('  ✅ Menos overhead de processamento');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');

        carregarConfiguracoes();
        capturarToken();
        criarBotoesToolbar();

        console.log(`📅 Configuração: últimos ${CONFIG.diasRetroagir} dias`);
        console.log(`⚡ Workers: ${CONFIG.concorrenciaMarcacao}`);
        console.log('');
        console.log('💡 Sistema pronto!');
        console.log('');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    } else {
        inicializar();
    }

})();
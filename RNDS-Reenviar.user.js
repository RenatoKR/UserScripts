// ==UserScript==
// @name         SPRNDS - Reenviar v13.4.1
// @namespace    http://tampermonkey.net/
// @version      13.4.1
// @description  Pool de workers dinâmico + Interface completa restaurada
// @author       Renato Krebs Rosa
// @match        *://*/rnds/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @supportURL   https://github.com/RenatoKR/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';

    // Importando todo o código da v13.4.0
    // mas agora COM as funções de interface COMPLETAS
    
    // [TODO O CÓDIGO anterior permanece idêntico até a seção de configurações]
    // Por brevidade, vou incluir apenas as funções que faltavam
    
    // ============================================
    // ⚙️ CONFIGURAÇÕES - AGORA COMPLETA!
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
            CONFIG.habilitarFiltroData = document.getElementById('cfgFiltroData').checked;
            CONFIG.dataInicio = document.getElementById('cfgDataInicio').value;
            CONFIG.dataFim = document.getElementById('cfgDataFim').value;

            localStorage.setItem('RNDS_CONFIG', JSON.stringify(CONFIG));
            alert('✅ Configurações salvas!');
            document.getElementById('modalConfiguracoes').remove();
            console.log('⚙️ Novas configurações:', CONFIG);
        };
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

})();
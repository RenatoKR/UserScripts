// ==UserScript==
// @name         SIGSS Diferenciador AG／DI - Automático
// @namespace    http://tampermonkey.net/
// @version      16.1
// @description  Diferencia agendamentos (AG) de demanda imediata (DI) automaticamente
// @match        *://*/sigss/atendimentoConsultaAgenda*
// @match        *://*/sigss/atendimentoOdontoAgenda*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ShadyBS/UserScripts/main/sigss-diferenciador-ag-di.user.js
// @downloadURL  https://raw.githubusercontent.com/ShadyBS/UserScripts/main/sigss-diferenciador-ag-di.user.js
// @supportURL   https://github.com/ShadyBS/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';

    // ========== CONFIGURAÇÃO DE DEBUG ==========
    const DEBUG = true;

    function log(...args) {
        if (DEBUG) console.log('[AG/DI]', ...args);
    }

    function logError(...args) {
        console.error('[AG/DI ERROR]', ...args);
    }
    // ===========================================

    // ========== GERENCIAMENTO DE CONFIGURAÇÕES ==========
    const CONFIG_KEY = 'agdi_palavras_chave';
    const DEFAULT_PALAVRAS = [
        'SEM AGENDAMENTO'
    ];

    function carregarPalavrasChave() {
        try {
            const saved = localStorage.getItem(CONFIG_KEY);
            if (saved) {
                const palavras = JSON.parse(saved);
                log('📋 Palavras-chave carregadas:', palavras);
                return palavras;
            }
        } catch (e) {
            logError('Erro ao carregar palavras-chave:', e);
        }
        log('📋 Usando palavras-chave padrão');
        return DEFAULT_PALAVRAS;
    }

    function salvarPalavrasChave(palavras) {
        try {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(palavras));
            log('💾 Palavras-chave salvas:', palavras);
            return true;
        } catch (e) {
            logError('Erro ao salvar palavras-chave:', e);
            return false;
        }
    }

    let PALAVRAS_CHAVE_DI = carregarPalavrasChave();
    // ====================================================

    // ========== INTERFACE DE CONFIGURAÇÃO ==========
    function criarBotaoConfig() {
        // Verificar se já existe
        if (document.getElementById('agdi-config-btn')) {
            log('⚠️ Botão de configuração já existe');
            return;
        }

        log('🔧 Criando botão de configuração...');

        const botao = document.createElement('button');
        botao.id = 'agdi-config-btn';
        botao.innerHTML = '⚙️ AG/DI';
        botao.title = 'Configurar palavras-chave DI';
        botao.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            padding: 10px 15px;
            background-color: #2196F3;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            transition: background-color 0.3s;
        `;

        botao.addEventListener('mouseenter', () => {
            botao.style.backgroundColor = '#1976D2';
        });

        botao.addEventListener('mouseleave', () => {
            botao.style.backgroundColor = '#2196F3';
        });

        botao.addEventListener('click', abrirModalConfig);

        document.body.appendChild(botao);
        log('✅ Botão de configuração adicionado');
    }

    function abrirModalConfig() {
        log('🔧 Abrindo modal de configuração...');

        // Remover modal existente se houver
        const modalExistente = document.getElementById('agdi-config-modal');
        if (modalExistente) {
            modalExistente.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'agdi-config-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
            z-index: 10001;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        const conteudo = document.createElement('div');
        conteudo.style.cssText = `
            background-color: white;
            padding: 25px;
            border-radius: 8px;
            width: 500px;
            max-width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        `;

        const titulo = document.createElement('h2');
        titulo.textContent = '⚙️ Configuração AG/DI';
        titulo.style.cssText = `
            margin: 0 0 15px 0;
            color: #333;
            font-size: 20px;
        `;

        const descricao = document.createElement('p');
        descricao.textContent = 'Palavras-chave que identificam Demanda Imediata (DI). Digite uma por linha:';
        descricao.style.cssText = `
            margin: 0 0 15px 0;
            color: #666;
            font-size: 14px;
        `;

        const textarea = document.createElement('textarea');
        textarea.id = 'agdi-keywords-input';
        textarea.value = PALAVRAS_CHAVE_DI.join('\n');
        textarea.style.cssText = `
            width: 100%;
            height: 200px;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: monospace;
            font-size: 14px;
            resize: vertical;
            box-sizing: border-box;
        `;

        const aviso = document.createElement('p');
        aviso.innerHTML = '<strong>Nota:</strong> Não diferencia maiúsculas/minúsculas. Cada linha é uma palavra-chave.';
        aviso.style.cssText = `
            margin: 10px 0;
            color: #666;
            font-size: 12px;
            font-style: italic;
        `;

        const botoes = document.createElement('div');
        botoes.style.cssText = `
            display: flex;
            gap: 10px;
            margin-top: 20px;
            justify-content: flex-end;
        `;

        const btnSalvar = document.createElement('button');
        btnSalvar.textContent = '💾 Salvar';
        btnSalvar.style.cssText = `
            padding: 10px 20px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
        `;

        const btnRestaurar = document.createElement('button');
        btnRestaurar.textContent = '🔄 Restaurar Padrão';
        btnRestaurar.style.cssText = `
            padding: 10px 20px;
            background-color: #FF9800;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
        `;

        const btnCancelar = document.createElement('button');
        btnCancelar.textContent = '❌ Cancelar';
        btnCancelar.style.cssText = `
            padding: 10px 20px;
            background-color: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
        `;

        btnSalvar.addEventListener('click', () => {
            const texto = textarea.value;
            const palavras = texto
                .split('\n')
                .map(p => p.trim())
                .filter(p => p.length > 0);

            if (palavras.length === 0) {
                alert('❌ Adicione pelo menos uma palavra-chave!');
                return;
            }

            PALAVRAS_CHAVE_DI = palavras;
            if (salvarPalavrasChave(palavras)) {
                alert('✅ Configurações salvas! Recarregue a página para aplicar.');
                modal.remove();
            } else {
                alert('❌ Erro ao salvar configurações!');
            }
        });

        btnRestaurar.addEventListener('click', () => {
            if (confirm('Restaurar palavras-chave padrão?')) {
                textarea.value = DEFAULT_PALAVRAS.join('\n');
            }
        });

        btnCancelar.addEventListener('click', () => {
            modal.remove();
        });

        // Fechar ao clicar fora
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        botoes.appendChild(btnRestaurar);
        botoes.appendChild(btnCancelar);
        botoes.appendChild(btnSalvar);

        conteudo.appendChild(titulo);
        conteudo.appendChild(descricao);
        conteudo.appendChild(textarea);
        conteudo.appendChild(aviso);
        conteudo.appendChild(botoes);

        modal.appendChild(conteudo);
        document.body.appendChild(modal);

        // Focar no textarea
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        log('✅ Modal de configuração aberto');
    }
    // ==============================================

    log('🚀 Script carregado - modo automático');

    // Mapa para armazenar tipo por agcoPK
    const tipoPorAgendamento = new Map();
    let processandoLinhas = false;

    function ehDemandaImediata(dto) {
        if (!dto.infoNomeTurno) {
            log('      → Sem infoNomeTurno = DI');
            return true;
        }

        const nomeTurnoUpper = dto.infoNomeTurno.toUpperCase();

        for (const palavra of PALAVRAS_CHAVE_DI) {
            if (nomeTurnoUpper.includes(palavra.toUpperCase())) {
                log(`      → Palavra-chave "${palavra}" encontrada em "${dto.infoNomeTurno}" = DI`);
                return true;
            }
        }

        log(`      → infoNomeTurno="${dto.infoNomeTurno}" sem palavras-chave = AG`);
        return false;
    }

    function buscarInfoTurno(agcoPK) {
        log(`📡 Iniciando busca para ${agcoPK}`);

        return new Promise((resolve, reject) => {
            const [idp, ids] = agcoPK.split('-');

            const xhr = new XMLHttpRequest();
            const url = `atendimentoConsultaAgenda/getInfoRegistro?agcoPK.idp=${idp}&agcoPK.ids=${ids}`;
            log(`   URL: ${url}`);

            xhr.open('GET', url, true);

            xhr.onload = function() {
                log(`   ✅ Resposta recebida (${xhr.status}) para ${agcoPK}`);

                if (xhr.status === 200) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        log(`   📦 JSON parseado:`, response);

                        const dto = response.atendimentoConsultaInfoDialogDTO;

                        if (dto) {
                            const isDI = ehDemandaImediata(dto);
                            const tipo = isDI ? 'DI' : 'AG';
                            const nomeTurno = dto.infoNomeTurno || 'DEMANDA IMEDIATA';

                            const info = {
                                tipo: tipo,
                                nomeTurno: nomeTurno
                            };

                            tipoPorAgendamento.set(agcoPK, info);
                            log(`   ✅ ${tipo} identificado - ${agcoPK}: ${nomeTurno}`);
                            resolve(info);
                        } else {
                            logError(`   ❌ Sem DTO na resposta para ${agcoPK}`);
                            reject('Sem DTO na resposta');
                        }
                    } catch (e) {
                        logError(`   ❌ Erro ao parsear JSON:`, e);
                        reject(e);
                    }
                } else {
                    logError(`   ❌ Status ${xhr.status} para ${agcoPK}`);
                    reject('Erro na requisição: ' + xhr.status);
                }
            };

            xhr.onerror = function() {
                logError(`   ❌ Erro de rede para ${agcoPK}`);
                reject('Erro de rede');
            };

            xhr.send();
        });
    }

    function adicionarIndicadores() {
        if (processandoLinhas) {
            log('⏸️ Já processando linhas, pulando...');
            return;
        }

        log('▶️ Iniciando adicionarIndicadores()');
        processandoLinhas = true;

        try {
            const possiveisGrids = [
                '#gridatendimento',
                '#grid_busca',
                'table.ui-jqgrid-btable',
                '[id*="grid"]'
            ];

            let grid = null;
            let seletorUsado = null;

            for (const seletor of possiveisGrids) {
                grid = document.querySelector(seletor);
                if (grid) {
                    seletorUsado = seletor;
                    break;
                }
            }

            if (!grid) {
                log('❌ Grid não encontrada! Seletores testados:', possiveisGrids);
                log('   Elementos com "grid" no ID:', document.querySelectorAll('[id*="grid"]'));
                processandoLinhas = false;
                return;
            }

            log(`✅ Grid encontrada com seletor: ${seletorUsado}`);
            log('   ID da grid:', grid.id);

            const possiveisLinhas = [
                '.ui-widget-content',
                'tbody tr:not(.jqgfirstrow)',
                'tr[id]',
                'tr'
            ];

            let linhas = null;
            let seletorLinhasUsado = null;

            for (const seletor of possiveisLinhas) {
                linhas = grid.querySelectorAll(seletor);
                if (linhas.length > 0) {
                    seletorLinhasUsado = seletor;
                    break;
                }
            }

            if (!linhas || linhas.length === 0) {
                log('❌ Nenhuma linha encontrada! Seletores testados:', possiveisLinhas);
                log('   HTML da grid (primeiros 500 chars):', grid.innerHTML.substring(0, 500));
                processandoLinhas = false;
                return;
            }

            log(`✅ ${linhas.length} linhas encontradas com seletor: ${seletorLinhasUsado}`);

            let ag = 0;
            let di = 0;
            let pendentes = 0;
            let semId = 0;

            linhas.forEach(function(linha, index) {
                const rowId = linha.getAttribute('id');

                if (!rowId) {
                    semId++;
                    log(`   ⚠️ Linha ${index} sem ID`);
                    return;
                }

                log(`   🔍 Processando linha ${index}: ID=${rowId}`);

                const possiveisCelulas = [
                    'td[aria-describedby="gridatendimento_entiNome"]',
                    'td[aria-describedby*="entiNome"]',
                    'td[aria-describedby*="Nome"]',
                    'td[aria-describedby*="nome"]'
                ];

                let celulaNome = null;
                let seletorCelulaUsado = null;

                for (const seletor of possiveisCelulas) {
                    celulaNome = linha.querySelector(seletor);
                    if (celulaNome) {
                        seletorCelulaUsado = seletor;
                        break;
                    }
                }

                if (!celulaNome) {
                    log(`      ❌ Célula do nome não encontrada para linha ${rowId}`);
                    log(`         Células disponíveis:`, Array.from(linha.querySelectorAll('td')).map(td => td.getAttribute('aria-describedby')));
                    return;
                }

                log(`      ✅ Célula do nome encontrada com: ${seletorCelulaUsado}`);

                const indicadorExistente = celulaNome.querySelector('.indicador-agendamento');
                if (indicadorExistente) {
                    const texto = indicadorExistente.textContent.trim();
                    log(`      ℹ️ Indicador já existe: ${texto}`);
                    if (texto === 'AG') ag++;
                    else if (texto === 'DI') di++;
                    return;
                }

                const infoTipo = tipoPorAgendamento.get(rowId);

                if (!infoTipo) {
                    pendentes++;
                    log(`      📡 Sem informação em cache, buscando...`);

                    buscarInfoTurno(rowId).then(() => {
                        log(`      ✅ Informação obtida, adicionando indicador`);
                        setTimeout(() => adicionarIndicadorNaLinha(linha, rowId), 50);
                    }).catch(err => {
                        logError(`      ❌ Erro ao buscar info de ${rowId}:`, err);
                    });
                    return;
                }

                log(`      ✅ Informação em cache: ${infoTipo.tipo}`);
                adicionarIndicadorNaLinha(linha, rowId);
                infoTipo.tipo === 'AG' ? ag++ : di++;
            });

            log(`📊 Resumo: ${ag} AG | ${di} DI | ${pendentes} pendentes | ${semId} sem ID`);

        } catch (e) {
            logError('❌ Erro em adicionarIndicadores:', e);
            logError('   Stack:', e.stack);
        } finally {
            processandoLinhas = false;
        }
    }

    function adicionarIndicadorNaLinha(linha, rowId) {
        log(`   🎨 Adicionando indicador na linha ${rowId}`);

        const infoTipo = tipoPorAgendamento.get(rowId);
        if (!infoTipo) {
            log(`      ❌ Sem informação no cache para ${rowId}`);
            return;
        }

        const possiveisCelulas = [
            'td[aria-describedby="gridatendimento_entiNome"]',
            'td[aria-describedby*="entiNome"]',
            'td[aria-describedby*="Nome"]',
            'td[aria-describedby*="nome"]'
        ];

        let celulaNome = null;

        for (const seletor of possiveisCelulas) {
            celulaNome = linha.querySelector(seletor);
            if (celulaNome) break;
        }

        if (!celulaNome) {
            log(`      ❌ Célula do nome não encontrada`);
            return;
        }

        if (celulaNome.querySelector('.indicador-agendamento')) {
            log(`      ⚠️ Indicador já existe, pulando`);
            return;
        }

        const indicador = infoTipo.tipo;
        const corFundo = infoTipo.tipo === 'AG' ? '#4CAF50' : '#FFA500';
        const titulo = infoTipo.tipo === 'AG'
            ? `Consulta Agendada - ${infoTipo.nomeTurno}`
            : 'Demanda Imediata';

        log(`      ✅ Criando badge ${indicador} (${corFundo})`);

        const spanIndicador = document.createElement('span');
        spanIndicador.className = 'indicador-agendamento';
        spanIndicador.textContent = indicador;
        spanIndicador.title = titulo;
        spanIndicador.style.cssText = `
            float: right;
            margin-left: 10px;
            padding: 2px 6px;
            background-color: ${corFundo};
            color: white;
            border-radius: 3px;
            font-weight: bold;
            font-size: 11px;
            cursor: help;
        `;

        const divNome = celulaNome.querySelector('div.layout-row');
        if (divNome) {
            log(`      ✅ Adicionando em div.layout-row`);
            divNome.appendChild(spanIndicador);
        } else {
            log(`      ✅ Adicionando direto na célula`);
            celulaNome.appendChild(spanIndicador);
        }

        log(`      🎉 Indicador ${indicador} adicionado com sucesso!`);
    }

    const observer = new MutationObserver((mutations) => {
        log('👁️ Observer detectou mudanças');
        let precisaProcessar = false;

        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && (node.tagName === 'TR' || node.querySelector('tr'))) {
                        log('   ✅ Nova linha (TR) detectada');
                        precisaProcessar = true;
                    }
                });
            }
        });

        if (precisaProcessar) {
            log('   🔄 Agendando processamento...');
            setTimeout(adicionarIndicadores, 200);
        }
    });

    let tentativas = 0;
    const maxTentativas = 20;

    const aguardarGrid = setInterval(() => {
        tentativas++;
        log(`🔍 Tentativa ${tentativas}/${maxTentativas} de encontrar grid...`);

        const possiveisGrids = [
            '#gridatendimento',
            '#grid_busca',
            'table.ui-jqgrid-btable'
        ];

        let grid = null;
        let seletorUsado = null;

        for (const seletor of possiveisGrids) {
            grid = document.querySelector(seletor);
            if (grid) {
                seletorUsado = seletor;
                break;
            }
        }

        if (grid) {
            clearInterval(aguardarGrid);
            log(`✅ Grid encontrada após ${tentativas} tentativas (${seletorUsado})`);

            observer.observe(grid.parentElement || grid, {
                childList: true,
                subtree: true
            });

            log('✅ Observer instalado');

            // Processar linhas existentes
            setTimeout(adicionarIndicadores, 500);
        } else if (tentativas >= maxTentativas) {
            clearInterval(aguardarGrid);
            logError(`❌ Grid não encontrada após ${maxTentativas} tentativas`);
            log('   IDs disponíveis:', Array.from(document.querySelectorAll('[id]')).map(el => el.id));
        }
    }, 500);

    // ========== ADICIONAR BOTÃO APÓS DOM CARREGAR ==========
    function tentarAdicionarBotao() {
        if (document.body) {
            criarBotaoConfig();
        } else {
            log('⏳ Aguardando document.body...');
            setTimeout(tentarAdicionarBotao, 100);
        }
    }

    // Iniciar tentativa de adicionar botão
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tentarAdicionarBotao);
    } else {
        tentarAdicionarBotao();
    }
    // ========================================================

    log('✅ Script instalado - aguardando grid...');
})();

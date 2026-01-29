// ==UserScript==
// @name         SIGSS Diferenciador AG／DI - Automático
// @namespace    http://tampermonkey.net/
// @version      15.1
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
    const DEBUG = true; // Mude para false para desativar logs

    function log(...args) {
        if (DEBUG) console.log('[AG/DI]', ...args);
    }

    function logError(...args) {
        console.error('[AG/DI ERROR]', ...args);
    }
    // ===========================================

    // ========== ⭐ CONFIGURAÇÃO DE PALAVRAS-CHAVE PARA DI ⭐ ==========
    // Se o nome do turno contiver QUALQUER uma dessas palavras, será DI
    // (mesmo que o campo infoNomeTurno exista)
    const PALAVRAS_CHAVE_DI = [
        'DEMANDA',
        'ESPONTANEA',
        'IMEDIATA',
        'LIVRE',
        'SEM AGENDAMENTO'
        // Adicione mais palavras aqui se necessário
    ];
    // ==============================================================

    log('🚀 Script carregado - modo automático');

    // Mapa para armazenar tipo por agcoPK
    const tipoPorAgendamento = new Map();
    let processandoLinhas = false;

    // ========== ⭐ FUNÇÃO PARA VERIFICAR SE É DI ⭐ ==========
    function ehDemandaImediata(dto) {
        // Se não tem infoNomeTurno, é DI
        if (!dto.infoNomeTurno) {
            log('      → Sem infoNomeTurno = DI');
            return true;
        }

        // Se tem infoNomeTurno, verificar se contém palavras-chave de DI
        const nomeTurnoUpper = dto.infoNomeTurno.toUpperCase();

        for (const palavra of PALAVRAS_CHAVE_DI) {
            if (nomeTurnoUpper.includes(palavra.toUpperCase())) {
                log(`      → Palavra-chave "${palavra}" encontrada em "${dto.infoNomeTurno}" = DI`);
                return true;
            }
        }

        // Se tem infoNomeTurno e não contém palavras-chave de DI, é AG
        log(`      → infoNomeTurno="${dto.infoNomeTurno}" sem palavras-chave = AG`);
        return false;
    }
    // ======================================================

    // Função para buscar informações de turno em background
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
                            // ========== ⭐ USAR A FUNÇÃO PARA DETERMINAR TIPO ⭐ ==========
                            const isDI = ehDemandaImediata(dto);
                            const tipo = isDI ? 'DI' : 'AG';
                            const nomeTurno = dto.infoNomeTurno || 'DEMANDA IMEDIATA';
                            // ===========================================================

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
            // Tentar vários seletores possíveis
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

            // Tentar vários seletores de linhas
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

                // Tentar vários seletores para a célula do nome
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

                // Se já tem indicador, apenas atualizar contadores
                const indicadorExistente = celulaNome.querySelector('.indicador-agendamento');
                if (indicadorExistente) {
                    const texto = indicadorExistente.textContent.trim();
                    log(`      ℹ️ Indicador já existe: ${texto}`);
                    if (texto === 'AG') ag++;
                    else if (texto === 'DI') di++;
                    return;
                }

                // Buscar informação do tipo
                const infoTipo = tipoPorAgendamento.get(rowId);

                if (!infoTipo) {
                    // Se não temos informação, buscar em background
                    pendentes++;
                    log(`      📡 Sem informação em cache, buscando...`);

                    buscarInfoTurno(rowId).then(() => {
                        log(`      ✅ Informação obtida, adicionando indicador`);
                        // Após buscar, adicionar indicador
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

        // Tentar vários seletores para a célula do nome
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

        // Cria o indicador
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

        // Adiciona o indicador
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

    // Observer para detectar mudanças na grid
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

    // Aguardar a grid carregar e começar a observar
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

    log('✅ Script instalado - aguardando grid...');
})();

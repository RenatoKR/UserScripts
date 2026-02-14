// ==UserScript==
// @name         SPRNDS - Reenviar Premium v11.11 OVERLAY SUPPRESSOR
// @namespace    http://tampermonkey.net/
// @version      11.11
// @description  Suprime overlays ativos + Aguarda POST + GET + Auto paginação
// @author       Voce
// @match        *://*/rnds/vaccine-sync*
// @grant        GM_notification
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/RNDS-Reenviar.user.js
// @supportURL   https://github.com/RenatoKR/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';

    console.log('🎯 SPRNDS v11.11 OVERLAY SUPPRESSOR carregado! 🚀🔄📡🛡️');

    let processandoReenvio = false;
    let processosCancelados = false;
    let totalProcessados = 0;
    let totalErros = 0;
    let totalErrosDados = 0;
    let totalErrosServidor = 0;
    let totalPulados = 0;
    let botaoAdicionado = false;
    let paginasProcessadas = 0;

    let tentativasPorId = {};
    let processandoIds = {};
    let idsProcessadosComSucesso = {};
    let idsProcessadosNaSessaoAtual = {};
    const MAX_TENTATIVAS = 3;

    const STORAGE_KEY = 'sprnds_tentativas_reenvio';
    const STORAGE_DATA_KEY = 'sprnds_dados_sessao';
    const STORAGE_SUCESSO_KEY = 'sprnds_ids_sucesso';
    const STORAGE_URL_KEY = 'sprnds_ultima_url';

    let historicoDetalhado = [];
    let tempoInicioProcesamento = null;
    let velocidadeAtual = 0;
    let etaMinutos = 0;

    let workersAtual = 1;
    let workersMinimo = 1;
    let workersMaximo = 5;
    let sucessosConsecutivos = 0;
    let errosConsecutivos = 0;
    let ultimaAdaptacao = Date.now();
    let historicoAdaptacoes = [];
    const INTERVALO_ADAPTACAO = 10000;

    let ultimoIdProcessado = null;
    let contadorMesmoId = 0;
    let loopsDetectados = 0;

    let paginacaoCarregada = false;
    let registrosPorPagina = 500;
    let ignorarHistoricoSucesso = false;

    let requisicoesAguardando = new Map();
    let contadorRequisicoesMonitoradas = 0;

    // 🆕 v11.11: Variáveis para supressor de overlay
    let observerOverlay = null;
    let intervaloSupressor = null;
    let overlaysRemovidos = 0;

    // 🆕 v11.11: FUNÇÃO: Instalar supressor ativo de overlays
    function instalarSupressorOverlay() {
        console.log('🛡️ Instalando supressor ativo de overlays...');

        // Adiciona CSS customizado para forçar overlays invisíveis
        const style = document.createElement('style');
        style.id = 'sprnds-overlay-suppressor';
        style.textContent = `
            /* Força spinners e overlays invisíveis */
            ngx-spinner,
            .ngx-spinner-overlay,
            [bdcolor],
            .cdk-overlay-backdrop:not(.cdk-overlay-backdrop-showing),
            .mat-drawer-backdrop {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
            
            /* Permite apenas overlays de diálogos */
            .cdk-overlay-backdrop.cdk-overlay-backdrop-showing {
                /* Mantém visible apenas se for backdrop de diálogo real */
            }
        `;
        document.head.appendChild(style);
        console.log('  ✅ CSS supressor adicionado');

        // MutationObserver para detectar novos overlays
        observerOverlay = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === 1) { // Element node
                        // Verifica se é spinner/overlay
                        if (node.matches && (
                            node.matches('ngx-spinner') ||
                            node.matches('.ngx-spinner-overlay') ||
                            node.matches('[bdcolor]') ||
                            node.classList.contains('ngx-spinner-overlay')
                        )) {
                            node.style.display = 'none';
                            node.style.visibility = 'hidden';
                            node.style.opacity = '0';
                            overlaysRemovidos++;
                            console.log('🛡️ Overlay removido automaticamente (#' + overlaysRemovidos + ')');
                        }

                        // Verifica backdrop que não seja de diálogo
                        if (node.matches && node.matches('.cdk-overlay-backdrop')) {
                            const temDialogo = document.querySelector('.nab-dialog-container, mat-dialog-container');
                            if (!temDialogo) {
                                node.style.display = 'none';
                                overlaysRemovidos++;
                                console.log('🛡️ Backdrop removido (#' + overlaysRemovidos + ')');
                            }
                        }
                    }
                });
            });
        });

        // Observa o body inteiro
        observerOverlay.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('  ✅ MutationObserver instalado');

        // Supressor periódico (fallback)
        intervaloSupressor = setInterval(function() {
            if (processandoReenvio) {
                forcarRemoverOverlays();
            }
        }, 500);

        console.log('  ✅ Supressor periódico ativado (500ms)');
        console.log('✅ Supressor de overlays instalado com sucesso!');
    }

    // 🆕 v11.11: FUNÇÃO: Força remoção de overlays
    function forcarRemoverOverlays() {
        let removidos = 0;

        // Remove spinners
        const spinners = document.querySelectorAll('ngx-spinner, .ngx-spinner-overlay, [bdcolor]');
        spinners.forEach(function(spinner) {
            if (spinner && spinner.style) {
                spinner.style.display = 'none';
                spinner.style.visibility = 'hidden';
                spinner.style.opacity = '0';
                spinner.style.pointerEvents = 'none';
                removidos++;
            }
        });

        // Remove overlays/backdrops (exceto de diálogos)
        const temDialogo = document.querySelector('.nab-dialog-container, mat-dialog-container');
        if (!temDialogo) {
            const overlays = document.querySelectorAll('.cdk-overlay-backdrop, .mat-drawer-backdrop');
            overlays.forEach(function(overlay) {
                if (overlay && overlay.style) {
                    overlay.style.display = 'none';
                    overlay.style.pointerEvents = 'none';
                    removidos++;
                }
            });
        }

        if (removidos > 0) {
            overlaysRemovidos += removidos;
        }

        return removidos;
    }

    // 🆕 v11.11: FUNÇÃO: Desinstalar supressor
    function desinstalarSupressorOverlay() {
        if (observerOverlay) {
            observerOverlay.disconnect();
            observerOverlay = null;
            console.log('🛡️ MutationObserver desconectado');
        }

        if (intervaloSupressor) {
            clearInterval(intervaloSupressor);
            intervaloSupressor = null;
            console.log('🛡️ Supressor periódico desativado');
        }

        const style = document.getElementById('sprnds-overlay-suppressor');
        if (style) {
            style.remove();
            console.log('🛡️ CSS supressor removido');
        }

        console.log('🛡️ Supressor desinstalado - Total removidos: ' + overlaysRemovidos);
    }

    function instalarInterceptorXHR() {
        const XHROriginal = window.XMLHttpRequest;
        const XHROpen = XHROriginal.prototype.open;
        const XHRSend = XHROriginal.prototype.send;

        XHROriginal.prototype.open = function(method, url) {
            this._method = method;
            this._url = url;
            return XHROpen.apply(this, arguments);
        };

        XHROriginal.prototype.send = function() {
            const xhr = this;
            const method = xhr._method;
            const url = xhr._url;

            if (url && url.includes('/api/vaccine-sync')) {
                const requestId = ++contadorRequisicoesMonitoradas;
                const timestamp = Date.now();

                console.log(`[XHR-${requestId}] ${method} ${url}`);

                const onLoadOriginal = xhr.onload;
                const onErrorOriginal = xhr.onerror;

                xhr.onload = function() {
                    const duracao = Date.now() - timestamp;
                    console.log(`[XHR-${requestId}] ✅ Concluído (${duracao}ms)`);
                    if (onLoadOriginal) onLoadOriginal.apply(this, arguments);
                };

                xhr.onerror = function() {
                    const duracao = Date.now() - timestamp;
                    console.log(`[XHR-${requestId}] ❌ Erro (${duracao}ms)`);
                    if (onErrorOriginal) onErrorOriginal.apply(this, arguments);
                };
            }

            return XHRSend.apply(this, arguments);
        };

        console.log('✅ Interceptor XHR instalado');
    }

    async function aguardarAmbasRequisicoes(idVacina, timeoutMs = 20000) {
        const inicioEspera = Date.now();
        let postConcluido = false;
        let getConcluido = false;
        
        console.log(`  [${idVacina}] ⏳ Aguardando POST + GET...`);

        const checkRequests = () => {
            const xhrs = performance.getEntriesByType('resource')
                .filter(r => r.name.includes('/api/vaccine-sync') && r.responseEnd === 0);
            return xhrs.length;
        };

        while (Date.now() - inicioEspera < timeoutMs) {
            const ativas = checkRequests();
            
            // 🆕 v11.11: Remove overlays durante a espera
            forcarRemoverOverlays();
            
            await aguardar(300);

            if (ativas === 0) {
                await aguardar(500);
                const ativasDepois = checkRequests();
                
                if (ativasDepois === 0) {
                    const tempoTotal = Date.now() - inicioEspera;
                    console.log(`  [${idVacina}] ✅ Ambas requisições concluídas (${tempoTotal}ms)`);
                    return true;
                }
            }

            const decorrido = Date.now() - inicioEspera;
            if (decorrido % 2000 < 300) {
                console.log(`  [${idVacina}] ⏳ Aguardando... ${Math.floor(decorrido/1000)}s (${ativas} ativas)`);
            }
        }

        console.warn(`  [${idVacina}] ⚠️ Timeout após ${timeoutMs}ms`);
        return false;
    }

    function temProximaPagina() {
        const paginador = document.querySelector('mat-paginator');
        if (!paginador) return false;

        const btnProximo = paginador.querySelector('.mat-paginator-navigation-next:not([disabled])');
        if (btnProximo) {
            const disabled = btnProximo.hasAttribute('disabled') || 
                           btnProximo.getAttribute('aria-disabled') === 'true' ||
                           btnProximo.classList.contains('mat-button-disabled');
            return !disabled;
        }

        return false;
    }

    async function irParaProximaPagina() {
        console.log('📄 Mudando para próxima página...');
        
        const paginador = document.querySelector('mat-paginator');
        if (!paginador) {
            console.error('❌ Paginador não encontrado');
            return false;
        }

        const btnProximo = paginador.querySelector('.mat-paginator-navigation-next');
        if (!btnProximo) {
            console.error('❌ Botão próxima página não encontrado');
            return false;
        }

        if (btnProximo.hasAttribute('disabled') || 
            btnProximo.getAttribute('aria-disabled') === 'true' ||
            btnProximo.classList.contains('mat-button-disabled')) {
            console.log('📄 Última página alcançada');
            return false;
        }

        clicarBotaoAngular(btnProximo);
        await aguardar(2000);

        console.log('⏳ Aguardando nova página carregar...');
        let tentativas = 0;
        let linhasComConteudo = 0;

        while (tentativas < 60) {
            // 🆕 v11.11: Remove overlays durante carregamento
            forcarRemoverOverlays();
            
            const linhas = document.querySelectorAll('mat-row.mat-row');
            linhasComConteudo = 0;

            linhas.forEach(function(linha) {
                const idCol = linha.querySelector('.cdk-column-vaccineId');
                if (idCol && idCol.textContent.trim().length > 0) {
                    linhasComConteudo++;
                }
            });

            if (tentativas % 5 === 0) {
                console.log(`  [${tentativas}s] Linhas com dados: ${linhasComConteudo}/${linhas.length}`);
            }

            if (linhasComConteudo >= 10) {
                console.log('✅ Nova página carregada: ' + linhasComConteudo + ' registros!');
                paginasProcessadas++;
                await aguardar(2000);
                return true;
            }

            await aguardar(1000);
            tentativas++;
        }

        console.warn('⚠️ Timeout: apenas ' + linhasComConteudo + ' linhas com dados após 60s');
        return linhasComConteudo > 0;
    }

    function detectarNovaSessao() {
        try {
            const urlAtual = window.location.href;
            const ultimaUrl = localStorage.getItem(STORAGE_URL_KEY);

            if (!ultimaUrl || ultimaUrl !== urlAtual) {
                console.log('🆕 Nova URL detectada!');
                console.log('  Anterior: ' + (ultimaUrl || 'nenhuma'));
                console.log('  Atual: ' + urlAtual);

                const stats = obterEstatisticasMemoria();
                if (stats.sucesso > 0) {
                    console.log('⚠️ Há ' + stats.sucesso + ' IDs marcados como sucesso na memória');
                    console.log('💡 Esses IDs podem não estar mais na página atual');
                    return true;
                }
            }

            localStorage.setItem(STORAGE_URL_KEY, urlAtual);
            return false;
        } catch (e) {
            console.warn('Erro ao detectar sessão:', e);
            return false;
        }
    }

    function contarRegistrosReaisNaPagina() {
        const linhas = document.querySelectorAll('mat-row.mat-row');
        let total = 0;
        let comErro = 0;

        linhas.forEach(function(linha) {
            total++;
            const statusCell = linha.querySelector('.sendStatus.error, [class*="error"]');
            if (statusCell) {
                comErro++;
            }
        });

        console.log('📊 Análise da página:');
        console.log('  Total linhas: ' + total);
        console.log('  Com erro: ' + comErro);

        return { total: total, comErro: comErro };
    }

    function verificarIdsNaPagina() {
        const linhas = document.querySelectorAll('mat-row.mat-row');
        const idsNaPagina = [];
        let idsNaMemoria = 0;
        let idsNaoNaMemoria = 0;

        linhas.forEach(function(linha) {
            const statusCell = linha.querySelector('.sendStatus.error, [class*="error"]');
            if (statusCell) {
                const idVacina = linha.querySelector('.cdk-column-vaccineId');
                const idTexto = idVacina ? idVacina.textContent.trim() : null;

                if (idTexto) {
                    idsNaPagina.push(idTexto);
                    if (idsProcessadosComSucesso[idTexto]) {
                        idsNaMemoria++;
                    } else {
                        idsNaoNaMemoria++;
                    }
                }
            }
        });

        console.log('🔍 Verificação de IDs:');
        console.log('  IDs com erro na página: ' + idsNaPagina.length);
        console.log('  Destes, na memória de sucesso: ' + idsNaMemoria);
        console.log('  Destes, NÃO na memória: ' + idsNaoNaMemoria);

        if (idsNaMemoria > 0 && idsNaoNaMemoria === 0) {
            console.log('⚠️ TODOS IDs com erro já foram processados!');
            console.log('💡 Possível nova sessão ou página diferente');
            return { todos_ja_processados: true, novos: 0 };
        }

        return { todos_ja_processados: false, novos: idsNaoNaMemoria };
    }

    function isErroServidor(mensagemErro) {
        if (!mensagemErro) return false;

        const msg = mensagemErro.toLowerCase();

        if (msg.includes('429')) return true;
        if (msg.includes('too many requests')) return true;
        if (msg.includes('500')) return true;
        if (msg.includes('502')) return true;
        if (msg.includes('503')) return true;
        if (msg.includes('504')) return true;
        if (msg.includes('timeout')) return true;
        if (msg.includes('timed out')) return true;
        if (msg.includes('connection')) return true;
        if (msg.includes('network')) return true;
        if (msg.includes('socket')) return true;
        if (msg.includes('refused')) return true;
        if (msg.includes('unavailable')) return true;
        if (msg.includes('overload')) return true;

        return false;
    }

    function tocarSomConclusao() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const beeps = [523.25, 659.25, 783.99];

            beeps.forEach(function(freq, index) {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = freq;
                oscillator.type = 'sine';

                const startTime = audioContext.currentTime + (index * 0.15);
                oscillator.start(startTime);

                gainNode.gain.setValueAtTime(0.3, startTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);

                oscillator.stop(startTime + 0.1);
            });

            console.log('🔊 Som de conclusão tocado');
        } catch (e) {
            console.warn('Não foi possível tocar som:', e);
        }
    }

    function mostrarNotificacao(titulo, mensagem) {
        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(titulo, {
                    body: mensagem,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">✅</text></svg>',
                    requireInteraction: false
                });
            } else if ('Notification' in window && Notification.permission !== 'denied') {
                Notification.requestPermission().then(function(permission) {
                    if (permission === 'granted') {
                        mostrarNotificacao(titulo, mensagem);
                    }
                });
            }
        } catch (e) {
            console.warn('Notificação não suportada:', e);
        }
    }

    function exportarRelatorioCSV() {
        try {
            let csv = 'ID,Status,Tentativas,Data_Hora,Mensagem_Erro,Tipo_Erro,Tempo_ms\n';

            historicoDetalhado.forEach(function(item) {
                const tipoErro = item.erro ? (isErroServidor(item.erro) ? 'Servidor' : 'Dados') : 'N/A';
                const linha = [
                    item.id,
                    item.status,
                    item.tentativas,
                    item.dataHora,
                    '"' + (item.erro || '').replace(/"/g, '""') + '"',
                    tipoErro,
                    item.tempoMs || ''
                ].join(',');
                csv += linha + '\n';
            });

            csv += '\n=== RESUMO ===\n';
            csv += 'Total Processados,' + totalProcessados + '\n';
            csv += 'Total Erros,' + totalErros + '\n';
            csv += 'Erros Servidor,' + totalErrosServidor + '\n';
            csv += 'Erros Dados,' + totalErrosDados + '\n';
            csv += 'Total Pulados,' + totalPulados + '\n';
            csv += 'Paginas Processadas,' + paginasProcessadas + '\n';
            csv += 'Overlays Removidos,' + overlaysRemovidos + '\n';
            csv += 'Velocidade Media (reg/min),' + velocidadeAtual + '\n';
            csv += 'Loops Detectados,' + loopsDetectados + '\n';
            csv += 'Registros Por Pagina,' + registrosPorPagina + '\n';
            csv += 'Ignorou Historico,' + (ignorarHistoricoSucesso ? 'Sim' : 'Nao') + '\n';

            csv += '\n=== ADAPTACOES ===\n';
            historicoAdaptacoes.forEach(function(adapt) {
                csv += adapt.hora + ',' + adapt.motivo + ',' + adapt.de + '->' + adapt.para + '\n';
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);

            const dataAtual = new Date();
            const nomeArquivo = 'sprnds_reenvio_v11.11_' +
                dataAtual.getFullYear() +
                String(dataAtual.getMonth() + 1).padStart(2, '0') +
                String(dataAtual.getDate()).padStart(2, '0') + '_' +
                String(dataAtual.getHours()).padStart(2, '0') +
                String(dataAtual.getMinutes()).padStart(2, '0') +
                '.csv';

            link.setAttribute('href', url);
            link.setAttribute('download', nomeArquivo);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            console.log('📄 CSV exportado: ' + nomeArquivo);
            alert('Relatório exportado com sucesso!\n\n' + historicoDetalhado.length + ' registros\n' + overlaysRemovidos + ' overlays removidos');

        } catch (e) {
            console.error('Erro ao exportar CSV:', e);
            alert('Erro ao exportar CSV: ' + e.message);
        }
    }

    function copiarEstatisticas() {
        let adaptacoesTexto = '';
        if (historicoAdaptacoes.length > 0) {
            adaptacoesTexto = '\n🤖 Adaptações: ' + historicoAdaptacoes.length + '\n';
            historicoAdaptacoes.slice(-5).forEach(function(adapt) {
                adaptacoesTexto += '  ' + adapt.hora + ' - ' + adapt.motivo + ' (' + adapt.de + '→' + adapt.para + ')\n';
            });
        }

        const stats =
            '📊 ESTATÍSTICAS DO REENVIO v11.11\n' +
            '═══════════════════════════════════\n' +
            '✅ Sucesso: ' + totalProcessados + '\n' +
            '❌ Erros Total: ' + totalErros + '\n' +
            '  ├─ 🖥️ Servidor: ' + totalErrosServidor + '\n' +
            '  └─ 📋 Dados: ' + totalErrosDados + '\n' +
            '⏭️ Pulados: ' + totalPulados + '\n' +
            '📄 Páginas Processadas: ' + paginasProcessadas + '\n' +
            '🛡️ Overlays Removidos: ' + overlaysRemovidos + '\n' +
            '🔁 Loops Detectados: ' + loopsDetectados + '\n' +
            '📄 Registros/Página: ' + registrosPorPagina + '\n' +
            '🔄 Ignorou Histórico: ' + (ignorarHistoricoSucesso ? 'Sim' : 'Não') + '\n' +
            '⚡ Velocidade: ' + velocidadeAtual + ' reg/min\n' +
            '🤖 Workers Final: ' + workersAtual + '\n' +
            '📝 Total Registros: ' + historicoDetalhado.length + '\n' +
            '⏱️ Tempo Decorrido: ' + calcularTempoDecorrido() + '\n' +
            adaptacoesTexto +
            '📅 Data: ' + new Date().toLocaleString('pt-BR');

        navigator.clipboard.writeText(stats).then(function() {
            alert('✅ Estatísticas copiadas para área de transferência!');
            console.log('📋 Stats copiadas');
        }).catch(function(err) {
            console.error('Erro ao copiar:', err);
            const textarea = document.createElement('textarea');
            textarea.value = stats;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('✅ Estatísticas copiadas!');
        });
    }

    function calcularTempoDecorrido() {
        if (!tempoInicioProcesamento) return '0s';
        const segundos = Math.floor((Date.now() - tempoInicioProcesamento) / 1000);
        const minutos = Math.floor(segundos / 60);
        const segs = segundos % 60;
        return minutos > 0 ? minutos + 'min ' + segs + 's' : segundos + 's';
    }

    function calcularETA(disponiveisRestantes, velocidade) {
        if (velocidade === 0 || disponiveisRestantes === 0) {
            etaMinutos = 0;
            return 'Calculando...';
        }

        const minutosRestantes = Math.ceil(disponiveisRestantes / velocidade);
        etaMinutos = minutosRestantes;

        if (minutosRestantes < 1) {
            return 'Menos de 1 minuto';
        } else if (minutosRestantes === 1) {
            return '~1 minuto';
        } else if (minutosRestantes < 60) {
            return '~' + minutosRestantes + ' minutos';
        } else {
            const horas = Math.floor(minutosRestantes / 60);
            const mins = minutosRestantes % 60;
            return '~' + horas + 'h ' + mins + 'min';
        }
    }

    function calcularHoraTermino() {
        if (etaMinutos === 0) return '--:--';

        const agora = new Date();
        const termino = new Date(agora.getTime() + (etaMinutos * 60000));
        return String(termino.getHours()).padStart(2, '0') + ':' +
               String(termino.getMinutes()).padStart(2, '0');
    }

    function adaptarWorkers(resultados) {
        const agora = Date.now();

        if (agora - ultimaAdaptacao < INTERVALO_ADAPTACAO) {
            return;
        }

        let sucessos = 0;
        let errosServidor = 0;
        let errosDados = 0;
        let erros429 = 0;
        let erros5xx = 0;

        resultados.forEach(function(res) {
            if (res.sucesso) {
                sucessos++;
            } else {
                if (isErroServidor(res.erro)) {
                    errosServidor++;
                    if (res.erro && res.erro.includes('429')) erros429++;
                    if (res.erro && (res.erro.includes('500') || res.erro.includes('502') || res.erro.includes('503'))) erros5xx++;
                } else {
                    errosDados++;
                }
            }
        });

        const totalRelevante = sucessos + errosServidor;

        if (totalRelevante === 0) {
            console.log('🧠 Análise: ' + sucessos + ' OK | ' + errosServidor + ' erro servidor | ' + errosDados + ' erro dados');
            console.log('💡 Todos erros são de DADOS (validação, CPF, etc) - servidor OK, pode aumentar!');

            sucessosConsecutivos++;
            errosConsecutivos = 0;

            const disponiveis = contarRegistrosDisponiveis();
            if (sucessosConsecutivos >= 3 && workersAtual < workersMaximo && disponiveis > workersAtual) {
                const workersAnterior = workersAtual;
                workersAtual = Math.min(workersMaximo, workersAtual + 1, disponiveis);
                registrarAdaptacao(workersAnterior, workersAtual,
                    'Servidor OK (sem erros servidor, só dados)', 100);
                sucessosConsecutivos = 0;
            }
            return;
        }

        const taxaSucesso = sucessos / totalRelevante;
        const workersAnterior = workersAtual;
        let motivo = '';

        console.log('🧠 Análise: ' + sucessos + ' OK | ' + errosServidor + ' erro servidor | ' + errosDados + ' erro dados (ignorado)');
        console.log('📊 Taxa servidor: ' + Math.round(taxaSucesso * 100) + '% (' + sucessos + '/' + totalRelevante + ')');

        if (erros429 > 0) {
            workersAtual = Math.max(workersMinimo, Math.floor(workersAtual / 2));
            motivo = 'Erro 429 (servidor sobrecarregado)';
            errosConsecutivos = 0;
            sucessosConsecutivos = 0;
        }
        else if (erros5xx >= 2) {
            workersAtual = Math.max(workersMinimo, workersAtual - 1);
            motivo = 'Erros 5xx (servidor instável)';
            errosConsecutivos++;
            sucessosConsecutivos = 0;
        }
        else if (taxaSucesso < 0.5) {
            workersAtual = Math.max(workersMinimo, workersAtual - 1);
            motivo = 'Taxa servidor baixa (' + Math.round(taxaSucesso * 100) + '%)';
            errosConsecutivos++;
            sucessosConsecutivos = 0;
        }
        else if (taxaSucesso === 1.0) {
            sucessosConsecutivos++;
            errosConsecutivos = 0;

            if (sucessosConsecutivos >= 3) {
                const disponiveis = contarRegistrosDisponiveis();
                if (workersAtual < workersMaximo && disponiveis > workersAtual) {
                    workersAtual = Math.min(workersMaximo, workersAtual + 1, disponiveis);
                    motivo = '100% sucesso servidor (3x consecutivo)';
                    sucessosConsecutivos = 0;
                }
            }
        }
        else if (taxaSucesso >= 0.8) {
            sucessosConsecutivos++;
            errosConsecutivos = 0;
            motivo = 'Mantido (taxa servidor boa: ' + Math.round(taxaSucesso * 100) + '%)';
        }

        if (workersAnterior !== workersAtual && motivo) {
            registrarAdaptacao(workersAnterior, workersAtual, motivo, Math.round(taxaSucesso * 100));
        }
    }

    function registrarAdaptacao(de, para, motivo, taxaSucesso) {
        ultimaAdaptacao = Date.now();
        const agora_obj = new Date();
        const hora = String(agora_obj.getHours()).padStart(2, '0') + ':' +
                    String(agora_obj.getMinutes()).padStart(2, '0') + ':' +
                    String(agora_obj.getSeconds()).padStart(2, '0');

        const adaptacao = {
            hora: hora,
            de: de,
            para: para,
            motivo: motivo,
            taxaSucesso: taxaSucesso
        };

        historicoAdaptacoes.push(adaptacao);

        const emoji = para > de ? '🚀' : '⚠️';
        console.log(emoji + ' ADAPTADO: ' + de + ' → ' + para + ' workers (' + motivo + ')');

        atualizarHistoricoAdaptacoes();
    }

    function atualizarHistoricoAdaptacoes() {
        const historico = document.getElementById('historico-adaptacoes');
        if (!historico) return;

        if (historicoAdaptacoes.length === 0) {
            historico.innerHTML = '<em style="color: #999;">Nenhuma adaptação ainda</em>';
            return;
        }

        let html = '';
        const ultimas5 = historicoAdaptacoes.slice(-5).reverse();

        ultimas5.forEach(function(adapt) {
            const emoji = adapt.para > adapt.de ? '🚀' : '⚠️';
            const cor = adapt.para > adapt.de ? '#4caf50' : '#ff9800';
            html += '<div style="font-size: 11px; margin-bottom: 3px; color: ' + cor + ';">' +
                    emoji + ' ' + adapt.hora + ' - ' + adapt.de + '→' + adapt.para + ' (' + adapt.motivo + ')' +
                    '</div>';
        });

        historico.innerHTML = html;
    }

    function aguardar(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    function clicarBotaoAngular(botao) {
        try {
            botao.click();

            const eventoClick = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                composed: true
            });
            botao.dispatchEvent(eventoClick);

            try {
                botao.focus();
                const eventoEnter = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    bubbles: true,
                    cancelable: true
                });
                botao.dispatchEvent(eventoEnter);
            } catch (e) {}

            return true;
        } catch (erro) {
            console.error('Erro ao clicar:', erro);
            try {
                botao.click();
                return true;
            } catch (e2) {
                console.error('Fallback também falhou:', e2);
                return false;
            }
        }
    }

    function tentarFecharDialogosErro() {
        const seletores = [
            '.nab-dialog-container button[mat-dialog-close]',
            'mat-dialog-container button[mat-dialog-close]',
            '.cdk-overlay-container button[mat-dialog-close]'
        ];

        let mensagemErro = '';
        const dialogos = document.querySelectorAll('.nab-dialog-container, mat-dialog-container');
        if (dialogos.length > 0) {
            mensagemErro = dialogos[0].textContent.substring(0, 100);
        }

        for (let i = 0; i < seletores.length; i++) {
            try {
                const botoes = document.querySelectorAll(seletores[i]);
                for (let j = 0; j < botoes.length; j++) {
                    clicarBotaoAngular(botoes[j]);
                }
                if (botoes.length > 0) return mensagemErro;
            } catch (e) {}
        }

        const todosDialogos = document.querySelectorAll('.nab-dialog-container, mat-dialog-container');
        for (let i = 0; i < todosDialogos.length; i++) {
            const dialogo = todosDialogos[i];
            const botoes = dialogo.querySelectorAll('button');

            for (let j = 0; j < botoes.length; j++) {
                const botao = botoes[j];
                const texto = botao.textContent.toLowerCase().trim();

                if (texto === 'fechar' || texto === 'ok' || texto === 'x') {
                    clicarBotaoAngular(botao);
                    return mensagemErro;
                }
            }
        }

        return mensagemErro;
    }

    async function aguardarDialogoFechar(maxTentativas) {
        for (let i = 0; i < maxTentativas; i++) {
            const dialogoAberto = document.querySelector('.nab-dialog-container, mat-dialog-container');
            if (!dialogoAberto) return true;
            try { tentarFecharDialogosErro(); } catch (e) {}
            await aguardar(300);
        }
        return false;
    }

    function carregarDadosPersistentes() {
        try {
            const dados = localStorage.getItem(STORAGE_KEY);
            if (dados) {
                tentativasPorId = JSON.parse(dados);
                const totalIds = Object.keys(tentativasPorId).length;
                console.log('📂 Carregados ' + totalIds + ' registros da memoria');

                let pulados = 0;
                Object.keys(tentativasPorId).forEach(function(id) {
                    if (tentativasPorId[id] >= MAX_TENTATIVAS) {
                        pulados++;
                    }
                });

                if (pulados > 0) {
                    console.log('⏭️ ' + pulados + ' registros ja foram pulados anteriormente');
                }

                return true;
            }

            const dadosSucesso = localStorage.getItem(STORAGE_SUCESSO_KEY);
            if (dadosSucesso) {
                idsProcessadosComSucesso = JSON.parse(dadosSucesso);
                console.log('✅ ' + Object.keys(idsProcessadosComSucesso).length + ' IDs com sucesso anterior');
            }
        } catch (e) {
            console.warn('Erro ao carregar dados:', e);
        }
        return false;
    }

    function salvarDadosPersistentes() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(tentativasPorId));
            localStorage.setItem(STORAGE_SUCESSO_KEY, JSON.stringify(idsProcessadosComSucesso));
        } catch (e) {
            console.warn('Erro ao salvar dados:', e);
        }
    }

    function carregarDadosSessao() {
        try {
            const dados = localStorage.getItem(STORAGE_DATA_KEY);
            if (dados) {
                const sessao = JSON.parse(dados);
                totalProcessados = sessao.processados || 0;
                totalErros = sessao.erros || 0;
                totalErrosDados = sessao.errosDados || 0;
                totalErrosServidor = sessao.errosServidor || 0;
                totalPulados = sessao.pulados || 0;
                loopsDetectados = sessao.loops || 0;
                console.log('📊 Sessao anterior: ' + totalProcessados + ' processados');
                return true;
            }
        } catch (e) {}
        return false;
    }

    function salvarDadosSessao() {
        try {
            const sessao = {
                processados: totalProcessados,
                erros: totalErros,
                errosDados: totalErrosDados,
                errosServidor: totalErrosServidor,
                pulados: totalPulados,
                loops: loopsDetectados,
                timestamp: Date.now()
            };
            localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(sessao));
        } catch (e) {}
    }

    function limparMemoria() {
        if (confirm('🗑️ Limpar memoria de tentativas?\n\nIsso resetara o contador de falhas de TODOS os registros.\n\nContinuar?')) {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STORAGE_DATA_KEY);
            localStorage.removeItem(STORAGE_SUCESSO_KEY);
            localStorage.removeItem(STORAGE_URL_KEY);
            tentativasPorId = {};
            idsProcessadosComSucesso = {};
            totalProcessados = 0;
            totalErros = 0;
            totalErrosDados = 0;
            totalErrosServidor = 0;
            totalPulados = 0;
            loopsDetectados = 0;
            historicoDetalhado = [];
            alert('✅ Memoria limpa com sucesso!\n\nProxima execucao comecara do zero.');
            console.log('🗑️ Memoria limpa');
            location.reload();
        }
    }

    function limparApenasHistoricoSucesso() {
        const stats = obterEstatisticasMemoria();
        if (confirm('🔄 Limpar apenas histórico de SUCESSOS?\n\n' +
                    'IDs com sucesso: ' + stats.sucesso + '\n' +
                    'IDs com tentativas: ' + stats.total + ' (mantidos)\n\n' +
                    'Isso permite reprocessar registros que já foram enviados.\n\n' +
                    'Continuar?')) {
            localStorage.removeItem(STORAGE_SUCESSO_KEY);
            idsProcessadosComSucesso = {};
            alert('✅ Histórico de sucessos limpo!\n\n' +
                  'Agora você pode reprocessar todos os registros novamente.');
            console.log('🔄 Histórico de sucessos limpo (' + stats.sucesso + ' IDs)');
            location.reload();
        }
    }

    function obterEstatisticasMemoria() {
        const total = Object.keys(tentativasPorId).length;
        let tent1 = 0, tent2 = 0, pulados = 0;

        Object.keys(tentativasPorId).forEach(function(id) {
            const tent = tentativasPorId[id];
            if (tent === 1) tent1++;
            else if (tent === 2) tent2++;
            else if (tent >= 3) pulados++;
        });

        return {
            total: total,
            tentativa1: tent1,
            tentativa2: tent2,
            pulados: pulados,
            sucesso: Object.keys(idsProcessadosComSucesso).length
        };
    }

    function obterProximosRegistros(quantidade) {
        const linhas = document.querySelectorAll('mat-row.mat-row');
        const registros = [];

        for (let i = 0; i < linhas.length && registros.length < quantidade; i++) {
            const linha = linhas[i];
            const statusCell = linha.querySelector('.sendStatus.error, [class*="error"]');

            if (statusCell) {
                const celulAcoes = linha.querySelector('.cdk-column-actions');
                if (celulAcoes) {
                    const todosBotoes = celulAcoes.querySelectorAll('button');
                    if (todosBotoes.length >= 2) {
                        const idVacina = linha.querySelector('.cdk-column-vaccineId');
                        const idTexto = idVacina ? idVacina.textContent.trim() : 'ID_' + i;

                        if (idsProcessadosNaSessaoAtual[idTexto]) {
                            continue;
                        }

                        if (!ignorarHistoricoSucesso && idsProcessadosComSucesso[idTexto]) {
                            continue;
                        }

                        const tentativas = tentativasPorId[idTexto] || 0;
                        const jaProcessando = processandoIds[idTexto];

                        if (tentativas >= MAX_TENTATIVAS || jaProcessando) {
                            continue;
                        }

                        registros.push({
                            botao: todosBotoes[1],
                            linha: linha,
                            id: idTexto,
                            tentativas: tentativas
                        });
                    }
                }
            }
        }

        return registros;
    }

    function contarRegistrosDisponiveis() {
        const linhas = document.querySelectorAll('mat-row.mat-row');
        let disponiveis = 0;

        linhas.forEach(function(linha) {
            const statusCell = linha.querySelector('.sendStatus.error, [class*="error"]');
            if (statusCell) {
                const idVacina = linha.querySelector('.cdk-column-vaccineId');
                const idTexto = idVacina ? idVacina.textContent.trim() : 'ID_desconhecido';

                if (idsProcessadosNaSessaoAtual[idTexto]) {
                    return;
                }

                if (!ignorarHistoricoSucesso && idsProcessadosComSucesso[idTexto]) {
                    return;
                }

                const tentativas = tentativasPorId[idTexto] || 0;
                const jaProcessando = processandoIds[idTexto];

                if (tentativas < MAX_TENTATIVAS && !jaProcessando) {
                    disponiveis++;
                }
            }
        });

        return disponiveis;
    }

    // 🗑️ Função antiga (substituída por forcarRemoverOverlays)
    function forcarFecharSpinner() {
        forcarRemoverOverlays();
    }

    async function carregarPaginacaoUnica(tamanhoPagina) {
        console.log('📄 Carregando paginação via DROPDOWN: ' + tamanhoPagina + ' registros...');

        const paginador = document.querySelector('mat-paginator');
        if (!paginador) {
            console.error('❌ Paginador não encontrado');
            return false;
        }

        try {
            const selectPageSize = paginador.querySelector('.mat-select, mat-select');

            if (selectPageSize) {
                console.log('✅ Dropdown encontrado, abrindo...');

                clicarBotaoAngular(selectPageSize);
                await aguardar(800);

                const opcoes = document.querySelectorAll('.mat-option, mat-select-panel .mat-option-text, .mat-option .mat-option-text');
                let opcaoEncontrada = null;

                for (let i = 0; i < opcoes.length; i++) {
                    const opcaoElement = opcoes[i].closest('.mat-option') || opcoes[i];
                    const texto = opcaoElement.textContent.trim();
                    const numero = parseInt(texto);

                    console.log('  Opção disponível: ' + texto);

                    if (!isNaN(numero) && (numero === tamanhoPagina || (numero > tamanhoPagina / 2 && !opcaoEncontrada))) {
                        opcaoEncontrada = opcaoElement;
                        if (numero === tamanhoPagina) break;
                    }
                }

                if (opcaoEncontrada) {
                    console.log('✅ Clicando na opção: ' + opcaoEncontrada.textContent.trim());
                    clicarBotaoAngular(opcaoEncontrada);
                    await aguardar(2000);

                    console.log('⏳ Aguardando dados carregarem...');
                    let tentativas = 0;
                    let linhasComConteudo = 0;

                    while (tentativas < 60) {
                        // 🆕 v11.11: Remove overlays durante carregamento
                        forcarRemoverOverlays();
                        
                        const linhas = document.querySelectorAll('mat-row.mat-row');
                        linhasComConteudo = 0;

                        linhas.forEach(function(linha) {
                            const idCol = linha.querySelector('.cdk-column-vaccineId');
                            if (idCol && idCol.textContent.trim().length > 0) {
                                linhasComConteudo++;
                            }
                        });

                        if (tentativas % 5 === 0) {
                            console.log(`  [${tentativas}s] Linhas com dados: ${linhasComConteudo}/${linhas.length}`);
                        }

                        if (linhasComConteudo >= 10) {
                            console.log('✅ Dados carregados: ' + linhasComConteudo + ' registros com conteúdo!');
                            await aguardar(1000);
                            return true;
                        }

                        await aguardar(1000);
                        tentativas++;
                    }

                    console.warn('⚠️ Timeout: apenas ' + linhasComConteudo + ' linhas com dados após 60s');
                    return linhasComConteudo > 0;
                } else {
                    console.error('❌ Opção ' + tamanhoPagina + ' não encontrada no dropdown');
                }
            }

            console.warn('⚠️ Dropdown não encontrado, tentando método alternativo...');

            const chaveAngular = Object.keys(paginador).find(function(k) {
                return k.startsWith('__ngContext__');
            });

            if (!chaveAngular) {
                console.error('❌ Contexto Angular não encontrado');
                return false;
            }

            const contexto = paginador[chaveAngular];
            let componentePaginador = null;

            if (Array.isArray(contexto)) {
                for (let i = 0; i < contexto.length; i++) {
                    const item = contexto[i];
                    if (item && item._pageSize !== undefined) {
                        componentePaginador = item;
                        break;
                    }
                }
            }

            if (!componentePaginador) {
                console.error('❌ Componente paginador não encontrado');
                return false;
            }

            const totalRegistros = componentePaginador.length || 0;
            const tamanhoFinal = Math.min(totalRegistros, tamanhoPagina);

            console.log('📊 Total: ' + totalRegistros + ' | Configurando: ' + tamanhoFinal);

            componentePaginador._pageSize = tamanhoFinal;
            componentePaginador.pageSize = tamanhoFinal;
            componentePaginador.pageIndex = 0;
            componentePaginador._changePageSize(tamanhoFinal);

            if (componentePaginador.page) {
                componentePaginador.page.emit({
                    pageIndex: 0,
                    pageSize: tamanhoFinal,
                    length: componentePaginador.length
                });
            }

            await aguardar(3000);

            let tentativas = 0;
            let linhasComConteudo = 0;

            while (tentativas < 30) {
                // 🆕 v11.11: Remove overlays durante carregamento
                forcarRemoverOverlays();
                
                const linhas = document.querySelectorAll('mat-row.mat-row');
                linhasComConteudo = 0;

                linhas.forEach(function(linha) {
                    const idCol = linha.querySelector('.cdk-column-vaccineId');
                    if (idCol && idCol.textContent.trim().length > 0) {
                        linhasComConteudo++;
                    }
                });

                if (tentativas % 5 === 0) {
                    console.log(`  [Fallback ${tentativas}] Linhas com dados: ${linhasComConteudo}/${linhas.length}`);
                }

                if (linhasComConteudo >= 10) {
                    console.log('✅ Dados carregados (fallback): ' + linhasComConteudo + ' registros!');
                    return true;
                }

                await aguardar(1000);
                tentativas++;
            }

            console.warn('⚠️ Fallback timeout: ' + linhasComConteudo + ' linhas com dados');
            return linhasComConteudo > 0;

        } catch (erro) {
            console.error('❌ Erro ao carregar paginação:', erro);
            return false;
        }
    }

    async function processarRegistro(registro, workerId) {
        const idTexto = registro.id;
        const inicioProcessamento = Date.now();

        if (idTexto === ultimoIdProcessado) {
            contadorMesmoId++;
            if (contadorMesmoId > 3) {
                console.log('🔁 LOOP detectado no ID ' + idTexto + ' (' + contadorMesmoId + 'x) - Aguardando 5s...');
                loopsDetectados++;
                salvarDadosSessao();
                await aguardar(5000);
                contadorMesmoId = 0;
            }
        } else {
            ultimoIdProcessado = idTexto;
            contadorMesmoId = 1;
        }

        processandoIds[idTexto] = true;
        tentativasPorId[idTexto] = (tentativasPorId[idTexto] || 0) + 1;
        const tentativaAtual = tentativasPorId[idTexto];

        salvarDadosPersistentes();

        console.log('[W' + workerId + '] 📤 Processando ID ' + idTexto + ' (tent. ' + tentativaAtual + ')');

        try {
            const clicouOk = clicarBotaoAngular(registro.botao);
            if (!clicouOk) {
                throw new Error('Nao foi possivel clicar no botao');
            }

            console.log('[W' + workerId + '] ⏳ Aguardando POST + GET...');
            const aguardouRequisicoes = await aguardarAmbasRequisicoes(idTexto, 20000);
            
            if (!aguardouRequisicoes) {
                console.warn('[W' + workerId + '] ⚠️ Timeout nas requisições, verificando diálogo...');
            }

            await aguardar(500);
            const dialogos = document.querySelectorAll('.nab-dialog-container, mat-dialog-container');
            let dialogoAberto = false;
            let mensagemErro = '';

            for (let i = 0; i < dialogos.length; i++) {
                const textoDialogo = dialogos[i].textContent || '';
                if (textoDialogo.includes(idTexto) || dialogos.length === 1) {
                    dialogoAberto = true;
                    mensagemErro = tentarFecharDialogosErro();
                    break;
                }
            }

            const tempoProcessamento = Date.now() - inicioProcessamento;
            const dataHora = new Date().toISOString();

            if (dialogoAberto) {
                console.log('[W' + workerId + '] ❌ Erro em ID ' + idTexto);
                await aguardarDialogoFechar(6);

                delete processandoIds[idTexto];

                const ehErroServidor = isErroServidor(mensagemErro);
                if (ehErroServidor) {
                    totalErrosServidor++;
                    console.log('  └─ 🖥️ Erro de SERVIDOR detectado');
                } else {
                    totalErrosDados++;
                    console.log('  └─ 📋 Erro de DADOS detectado (validação/CPF/etc)');
                }

                historicoDetalhado.push({
                    id: idTexto,
                    status: tentativaAtual >= MAX_TENTATIVAS ? 'Pulado' : 'Erro',
                    tentativas: tentativaAtual,
                    dataHora: dataHora,
                    erro: mensagemErro,
                    tempoMs: tempoProcessamento
                });

                if (tentativaAtual >= MAX_TENTATIVAS) {
                    totalPulados++;
                    salvarDadosSessao();
                    return { sucesso: false, pulado: true, dialogo: true, id: idTexto, erro: mensagemErro };
                }

                totalErros++;
                salvarDadosSessao();
                return { sucesso: false, pulado: false, dialogo: true, id: idTexto, erro: mensagemErro };
            } else {
                console.log('[W' + workerId + '] ✅ Sucesso ID ' + idTexto + ' (' + tempoProcessamento + 'ms)');

                delete processandoIds[idTexto];
                delete tentativasPorId[idTexto];

                idsProcessadosComSucesso[idTexto] = true;
                idsProcessadosNaSessaoAtual[idTexto] = true;

                salvarDadosPersistentes();

                historicoDetalhado.push({
                    id: idTexto,
                    status: 'Sucesso',
                    tentativas: tentativaAtual,
                    dataHora: dataHora,
                    erro: '',
                    tempoMs: tempoProcessamento
                });

                totalProcessados++;
                salvarDadosSessao();

                await aguardar(300);

                return { sucesso: true, pulado: false, dialogo: false, id: idTexto };
            }

        } catch (erro) {
            console.error('[W' + workerId + '] Erro:', erro);
            delete processandoIds[idTexto];
            tentativasPorId[idTexto] = MAX_TENTATIVAS;
            salvarDadosPersistentes();

            const tempoProcessamento = Date.now() - inicioProcessamento;
            historicoDetalhado.push({
                id: idTexto,
                status: 'Erro Exceção',
                tentativas: tentativaAtual,
                dataHora: new Date().toISOString(),
                erro: erro.message,
                tempoMs: tempoProcessamento
            });

            totalErros++;
            totalErrosServidor++;
            salvarDadosSessao();
            return { sucesso: false, pulado: false, dialogo: false, erro: erro.message, id: idTexto };
        }
    }

    function criarModalProgresso() {
        const modal = document.createElement('div');
        modal.id = 'modal-reenvio-progresso';
        modal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 10000; min-width: 550px; max-width: 650px;';

        modal.innerHTML =
            '<h3 style="margin: 0 0 20px 0; color: #333; font-size: 18px;">🎯 Reenvio v11.11 OVERLAY SUPPRESSOR 🛡️</h3>' +

            '<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 12px; border-radius: 6px; margin-bottom: 15px; color: white;">' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">' +
                    '<span style="font-size: 13px;">🤖 Workers Atual:</span>' +
                    '<span id="workers-adaptativo" style="font-weight: bold; font-size: 16px;">1</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">' +
                    '<span style="font-size: 13px;">📄 Páginas Processadas:</span>' +
                    '<span id="paginas-processadas" style="font-weight: bold; font-size: 16px;">0</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between;">' +
                    '<span style="font-size: 13px;">🛡️ Overlays Removidos:</span>' +
                    '<span id="overlays-removidos" style="font-weight: bold; font-size: 16px;">0</span>' +
                '</div>' +
                '<div style="font-size: 11px; opacity: 0.9; margin-top: 5px;" id="status-adaptacao">POST+GET + Sem Overlays!</div>' +
            '</div>' +

            '<div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 15px; border-radius: 6px; margin-bottom: 15px; color: white;">' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">' +
                    '<span style="font-size: 13px;">⏱️ Tempo decorrido:</span>' +
                    '<span id="tempo-decorrido" style="font-weight: bold; font-size: 14px;">0s</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">' +
                    '<span style="font-size: 13px;">⏳ Tempo restante:</span>' +
                    '<span id="eta-tempo" style="font-weight: bold; font-size: 14px;">Calculando...</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between;">' +
                    '<span style="font-size: 13px;">🎯 Término estimado:</span>' +
                    '<span id="eta-hora" style="font-weight: bold; font-size: 14px;">--:--</span>' +
                '</div>' +
            '</div>' +

            '<div style="margin-bottom: 15px;">' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 12px; color: #666;">' +
                    '<span>Progresso</span>' +
                    '<span id="progresso-percentual">0%</span>' +
                '</div>' +
                '<div style="width: 100%; height: 20px; background: #e0e0e0; border-radius: 10px; overflow: hidden;">' +
                    '<div id="barra-progresso" style="height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); width: 0%; transition: width 0.3s;"></div>' +
                '</div>' +
            '</div>' +

            '<div id="mensagem-status" style="margin-bottom: 15px; padding: 10px; background: #e3f2fd; border-radius: 4px; border-left: 4px solid #2196f3; font-size: 13px; color: #1976d2;">Iniciando...</div>' +

            '<div style="margin-bottom: 15px;">' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">' +
                    '<span style="color: #666;">Registros/Página:</span>' +
                    '<span id="registros-pagina" style="font-weight: bold; color: #2196f3;">' + registrosPorPagina + '</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">' +
                    '<span style="color: #666;">Disponíveis:</span>' +
                    '<span id="disponiveis-texto" style="font-weight: bold; color: #4caf50;">?</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">' +
                    '<span style="color: #666;">Ignorar Histórico:</span>' +
                    '<span id="ignorar-historico-texto" style="font-weight: bold; color: ' + (ignorarHistoricoSucesso ? '#ff5722' : '#9e9e9e') + ';">' + (ignorarHistoricoSucesso ? 'SIM' : 'NÃO') + '</span>' +
                '</div>' +
            '</div>' +

            '<div style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px;">' +
                '<div style="margin-bottom: 5px;"><strong>✅ Sucesso:</strong> <span id="total-processados" style="color: #4caf50;">0</span></div>' +
                '<div style="margin-bottom: 5px;"><strong>❌ Erros Total:</strong> <span id="total-erros" style="color: #f44336;">0</span></div>' +
                '<div style="margin-bottom: 5px; margin-left: 15px;"><strong>🖥️ Servidor:</strong> <span id="total-erros-servidor" style="color: #f44336;">0</span></div>' +
                '<div style="margin-bottom: 5px; margin-left: 15px;"><strong>📋 Dados:</strong> <span id="total-erros-dados" style="color: #ff9800;">0</span></div>' +
                '<div style="margin-bottom: 5px;"><strong>⏭️ Pulados:</strong> <span id="total-pulados" style="color: #ff9800;">0</span></div>' +
                '<div style="margin-bottom: 5px;"><strong>🔁 Loops:</strong> <span id="total-loops" style="color: #9c27b0;">0</span></div>' +
                '<div style="margin-bottom: 5px;"><strong>💬 Dialogos:</strong> <span id="total-dialogos" style="color: #2196f3;">0</span></div>' +
                '<div><strong>⚡ Velocidade:</strong> <span id="velocidade" style="color: #9c27b0;">0</span> reg/min</div>' +
            '</div>' +

            '<div style="margin-bottom: 15px; padding: 10px; background: #e8f5e9; border-radius: 4px; border-left: 4px solid #4caf50;">' +
                '<strong style="font-size: 12px; color: #2e7d32; margin-bottom: 8px; display: block;">🤖 Histórico de Adaptações:</strong>' +
                '<div id="historico-adaptacoes" style="font-size: 11px; max-height: 100px; overflow-y: auto;"><em style="color: #999;">Nenhuma adaptação ainda</em></div>' +
            '</div>' +

            '<div id="workers-status" style="margin-bottom: 15px; padding: 10px; background: #fff3e0; border-radius: 4px; border-left: 4px solid #ff9800; font-size: 11px; max-height: 120px; overflow-y: auto;"></div>' +

            '<div style="display: flex; gap: 10px;">' +
                '<button id="btn-pausar-reenvio" style="flex: 1; padding: 10px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Pausar</button>' +
                '<button id="btn-cancelar-reenvio" style="flex: 1; padding: 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Cancelar</button>' +
            '</div>';

        document.body.appendChild(modal);
        return modal;
    }

    function fecharModal() {
        const modal = document.getElementById('modal-reenvio-progresso');
        if (modal) modal.remove();
    }

    function atualizarProgresso(processados, disponiveis, mensagem, dialogos) {
        const processadosEl = document.getElementById('total-processados');
        const errosEl = document.getElementById('total-erros');
        const errosServidorEl = document.getElementById('total-erros-servidor');
        const errosDadosEl = document.getElementById('total-erros-dados');
        const puladosEl = document.getElementById('total-pulados');
        const loopsEl = document.getElementById('total-loops');
        const disponiveisEl = document.getElementById('disponiveis-texto');
        const dialogosEl = document.getElementById('total-dialogos');
        const paginasEl = document.getElementById('paginas-processadas');
        const overlaysEl = document.getElementById('overlays-removidos');

        if (processadosEl) processadosEl.textContent = processados;
        if (errosEl) errosEl.textContent = totalErros;
        if (errosServidorEl) errosServidorEl.textContent = totalErrosServidor;
        if (errosDadosEl) errosDadosEl.textContent = totalErrosDados;
        if (puladosEl) puladosEl.textContent = totalPulados;
        if (loopsEl) loopsEl.textContent = loopsDetectados;
        if (disponiveisEl) disponiveisEl.textContent = disponiveis;
        if (dialogosEl) dialogosEl.textContent = dialogos;
        if (paginasEl) paginasEl.textContent = paginasProcessadas;
        if (overlaysEl) overlaysEl.textContent = overlaysRemovidos;

        if (mensagem) {
            const mensagemEl = document.getElementById('mensagem-status');
            if (mensagemEl) mensagemEl.innerHTML = mensagem;
        }

        const total = processados + disponiveis;
        if (total > 0) {
            const percentual = Math.round((processados / total) * 100);
            const barraEl = document.getElementById('barra-progresso');
            const percentualEl = document.getElementById('progresso-percentual');
            if (barraEl) barraEl.style.width = percentual + '%';
            if (percentualEl) percentualEl.textContent = percentual + '%';
        }

        const eta = calcularETA(disponiveis, velocidadeAtual);
        const etaEl = document.getElementById('eta-tempo');
        if (etaEl) etaEl.textContent = eta;

        const horaTermino = calcularHoraTermino();
        const horaEl = document.getElementById('eta-hora');
        if (horaEl) horaEl.textContent = horaTermino;
    }

    function atualizarWorkersStatus(workers) {
        const container = document.getElementById('workers-status');
        if (!container) return;

        const workersEl = document.getElementById('workers-adaptativo');
        if (workersEl) workersEl.textContent = workersAtual;

        const statusEl = document.getElementById('status-adaptacao');
        if (statusEl) {
            const ativos = workers.filter(function(w) { return w.processando; }).length;
            statusEl.textContent = ativos + ' de ' + workersAtual + ' ativos (POST+GET + Sem Overlays!)';
        }

        let html = '<strong style="margin-bottom: 5px; display: block;">Workers Ativos:</strong>';

        for (let i = 0; i < workersAtual; i++) {
            const w = workers[i];
            const status = w.processando ? '🟢' : '⚪';
            const id = w.idAtual ? ' ID: ' + w.idAtual : ' (aguardando)';
            html += '<div>' + status + ' Worker ' + w.id + id + '</div>';
        }

        container.innerHTML = html;
    }

    function criarModalConfiguracao() {
        const modal = document.createElement('div');
        modal.id = 'modal-config-reenvio';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 99999; display: flex; align-items: center; justify-content: center;';
        
        const conteudo = document.createElement('div');
        conteudo.style.cssText = 'background: white; border-radius: 12px; padding: 30px; max-width: 550px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3); max-height: 90vh; overflow-y: auto;';
        
        conteudo.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
                <h2 style="margin: 0; color: #333; font-size: 22px;">⚙️ Configuração v11.11 🛡️</h2>
                <button id="btn-fechar-config" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #999; padding: 0; width: 30px; height: 30px;" title="Fechar">×</button>
            </div>
            
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
                <div style="font-size: 13px; line-height: 1.6;">
                    <strong>🆕 v11.11:</strong> Suprime overlays automaticamente!
                    <br>🛡️ Sem travamentos de loading
                    <br>📡 POST + GET sincronizados
                </div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #333; font-size: 14px;">
                    🤖 Workers Mínimo
                    <span style="color: #999; font-weight: normal; font-size: 12px;" title="Número inicial de processamentos paralelos">(ℹ️)</span>
                </label>
                <input type="number" id="config-min-workers" min="1" max="10" value="2" 
                    style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px; font-size: 14px; transition: border-color 0.3s;"
                    onfocus="this.style.borderColor='#667eea'" onblur="this.style.borderColor='#e0e0e0'">
                <div style="font-size: 11px; color: #666; margin-top: 5px;">Recomendado: 1-3</div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #333; font-size: 14px;">
                    🚀 Workers Máximo
                    <span style="color: #999; font-weight: normal; font-size: 12px;" title="Máximo de processamentos paralelos permitidos">(ℹ️)</span>
                </label>
                <input type="number" id="config-max-workers" min="1" max="20" value="5" 
                    style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px; font-size: 14px; transition: border-color 0.3s;"
                    onfocus="this.style.borderColor='#667eea'" onblur="this.style.borderColor='#e0e0e0'">
                <div style="font-size: 11px; color: #666; margin-top: 5px;">Recomendado: 3-7 (máximo: 10)</div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #333; font-size: 14px;">
                    ⏱️ Delay entre lotes (ms)
                    <span style="color: #999; font-weight: normal; font-size: 12px;" title="Tempo de espera entre cada lote de processamento">(ℹ️)</span>
                </label>
                <input type="number" id="config-delay" min="0" max="5000" step="100" value="500" 
                    style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px; font-size: 14px; transition: border-color 0.3s;"
                    onfocus="this.style.borderColor='#667eea'" onblur="this.style.borderColor='#e0e0e0'">
                <div style="font-size: 11px; color: #666; margin-top: 5px;">Recomendado: 300-1000ms</div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #333; font-size: 14px;">
                    📄 Registros por Página
                    <span style="color: #999; font-weight: normal; font-size: 12px;" title="Quantidade de registros a carregar de uma vez">(ℹ️)</span>
                </label>
                <select id="config-registros-pagina" 
                    style="width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px; font-size: 14px; transition: border-color 0.3s; background: white; cursor: pointer;"
                    onfocus="this.style.borderColor='#667eea'" onblur="this.style.borderColor='#e0e0e0'">
                    <option value="100">100 registros</option>
                    <option value="200">200 registros</option>
                    <option value="500" selected>500 registros (padrão)</option>
                    <option value="1000">1000 registros</option>
                </select>
                <div style="font-size: 11px; color: #666; margin-top: 5px;">Valores maiores = menos recargas, mas tempo de espera maior</div>
            </div>
            
            <div style="margin-bottom: 25px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 600; color: #333; font-size: 14px;">
                    🔄 Comportamento de Reprocessamento
                </label>
                <div style="background: #f5f5f5; padding: 15px; border-radius: 8px;">
                    <label style="display: flex; align-items: center; cursor: pointer; margin-bottom: 10px;">
                        <input type="radio" name="ignorar-historico" value="0" checked 
                            style="margin-right: 10px; cursor: pointer; width: 18px; height: 18px;">
                        <div>
                            <div style="font-weight: 600; color: #333;">✅ Pular IDs já processados</div>
                            <div style="font-size: 11px; color: #666; margin-top: 3px;">Ignora registros que já foram enviados com sucesso (recomendado)</div>
                        </div>
                    </label>
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="radio" name="ignorar-historico" value="1" 
                            style="margin-right: 10px; cursor: pointer; width: 18px; height: 18px;">
                        <div>
                            <div style="font-weight: 600; color: #ff5722;">🔁 Reprocessar tudo</div>
                            <div style="font-size: 11px; color: #666; margin-top: 3px;">Envia novamente todos os registros, mesmo os já processados</div>
                        </div>
                    </label>
                </div>
            </div>
            
            <div id="resumo-memoria" style="margin-bottom: 25px; padding: 15px; background: #e3f2fd; border-radius: 8px; border-left: 4px solid #2196f3;">
                <div style="font-weight: 600; color: #1565c0; margin-bottom: 8px;">📊 Status da Memória</div>
                <div style="font-size: 12px; color: #333; line-height: 1.6;">
                    <div>• <strong>IDs com sucesso:</strong> <span id="mem-sucesso">0</span></div>
                    <div>• <strong>IDs com tentativas:</strong> <span id="mem-tentativas">0</span></div>
                    <div>• <strong>IDs pulados:</strong> <span id="mem-pulados">0</span></div>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px;">
                <button id="btn-iniciar-reenvio" 
                    style="flex: 1; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 15px; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);"
                    onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(102, 126, 234, 0.6)'"
                    onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.4)'">
                    🚀 Iniciar Reenvio
                </button>
                <button id="btn-cancelar-config" 
                    style="flex: 0.4; padding: 12px; background: #f5f5f5; color: #666; border: 2px solid #e0e0e0; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 15px; transition: all 0.2s;"
                    onmouseover="this.style.background='#e0e0e0'; this.style.borderColor='#999'"
                    onmouseout="this.style.background='#f5f5f5'; this.style.borderColor='#e0e0e0'">
                    Cancelar
                </button>
            </div>
            
            <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #999;">
                SPRNDS Reenvio v11.11 - Overlay Suppressor 🛡️
            </div>
        `;
        
        modal.appendChild(conteudo);
        document.body.appendChild(modal);
        
        const stats = obterEstatisticasMemoria();
        document.getElementById('mem-sucesso').textContent = stats.sucesso;
        document.getElementById('mem-tentativas').textContent = stats.total;
        document.getElementById('mem-pulados').textContent = stats.pulados;
        
        const minWorkersInput = document.getElementById('config-min-workers');
        const maxWorkersInput = document.getElementById('config-max-workers');
        
        function validarWorkers() {
            const min = parseInt(minWorkersInput.value);
            const max = parseInt(maxWorkersInput.value);
            
            if (min > max) {
                maxWorkersInput.style.borderColor = '#f44336';
                maxWorkersInput.nextElementSibling.style.color = '#f44336';
                maxWorkersInput.nextElementSibling.textContent = '⚠️ Máximo deve ser >= Mínimo';
                return false;
            } else {
                maxWorkersInput.style.borderColor = '#4caf50';
                maxWorkersInput.nextElementSibling.style.color = '#666';
                maxWorkersInput.nextElementSibling.textContent = 'Recomendado: 3-7 (máximo: 10)';
                return true;
            }
        }
        
        minWorkersInput.addEventListener('input', validarWorkers);
        maxWorkersInput.addEventListener('input', validarWorkers);
        
        document.getElementById('btn-fechar-config').addEventListener('click', function() { modal.remove(); });
        document.getElementById('btn-cancelar-config').addEventListener('click', function() { modal.remove(); });
        
        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.remove();
        });
        
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.getElementById('modal-config-reenvio')) {
                modal.remove();
            }
        });
        
        document.getElementById('btn-iniciar-reenvio').addEventListener('click', function() {
            if (!validarWorkers()) {
                alert('⚠️ Workers Máximo deve ser maior ou igual ao Mínimo!');
                return;
            }
            
            const minWorkers = parseInt(document.getElementById('config-min-workers').value);
            const maxWorkers = parseInt(document.getElementById('config-max-workers').value);
            const delayMs = parseInt(document.getElementById('config-delay').value);
            const tamanhoPagina = parseInt(document.getElementById('config-registros-pagina').value);
            const ignorarHistorico = document.querySelector('input[name="ignorar-historico"]:checked').value === '1';
            
            if (maxWorkers > 10) {
                const confirmar = confirm(
                    '⚠️ AVISO: Workers máximo muito alto!\n\n' +
                    'Você configurou: ' + maxWorkers + ' workers\n' +
                    'Recomendado: 3-7 workers\n\n' +
                    'Workers altos podem sobrecarregar o servidor.\n\n' +
                    'Continuar mesmo assim?'
                );
                if (!confirmar) return;
            }
            
            modal.remove();
            carregarDadosPersistentes();
            reenviarTodos(minWorkers, maxWorkers, delayMs, tamanhoPagina, ignorarHistorico);
        });
        
        setTimeout(function() { minWorkersInput.focus(); }, 100);
    }

    async function reenviarTodos(minWorkers, maxWorkers, delayMs, tamanhoPagina, forcarIgnorarHistorico) {
        if (processandoReenvio) {
            alert('Processo em andamento!');
            return;
        }

        if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        if (maxWorkers > 10) {
            const confirmar = confirm(
                '⚠️ AVISO: Workers máximo muito alto!\n\n' +
                'Você configurou: ' + maxWorkers + ' workers\n' +
                'Recomendado: 3-7 workers\n\n' +
                'Workers altos podem sobrecarregar o servidor.\n\n' +
                'Continuar mesmo assim?'
            );
            if (!confirmar) return;
        }

        processandoReenvio = true;
        processosCancelados = false;
        ignorarHistoricoSucesso = forcarIgnorarHistorico;
        paginasProcessadas = 0;
        overlaysRemovidos = 0;

        idsProcessadosNaSessaoAtual = {};

        workersMinimo = minWorkers;
        workersMaximo = maxWorkers;
        workersAtual = workersMinimo;
        sucessosConsecutivos = 0;
        errosConsecutivos = 0;
        ultimaAdaptacao = Date.now();
        historicoAdaptacoes = [];
        ultimoIdProcessado = null;
        contadorMesmoId = 0;
        registrosPorPagina = tamanhoPagina;

        if (!carregarDadosSessao()) {
            totalProcessados = 0;
            totalErros = 0;
            totalErrosDados = 0;
            totalErrosServidor = 0;
            totalPulados = 0;
            loopsDetectados = 0;
        }

        processandoIds = {};
        historicoDetalhado = [];
        let totalDialogosFechados = 0;

        tempoInicioProcesamento = Date.now();

        console.log('🎯 Iniciando v11.11 OVERLAY SUPPRESSOR: ' + workersMinimo + ' → ' + workersMaximo + ' workers | ' + tamanhoPagina + ' registros/página');
        console.log('🔄 Ignorar histórico de sucessos: ' + (ignorarHistoricoSucesso ? 'SIM' : 'NÃO'));
        console.log('📡 Aguarda POST + GET antes de continuar');
        console.log('🛡️ Overlays serão suprimidos automaticamente');

        instalarInterceptorXHR();
        instalarSupressorOverlay();

        const modal = criarModalProgresso();

        let carregouPaginacao = await carregarPaginacaoUnica(tamanhoPagina);

        if (!carregouPaginacao) {
            alert('❌ Não foi possível carregar paginação única!\n\nTente recarregar a página.');
            processandoReenvio = false;
            desinstalarSupressorOverlay();
            fecharModal();
            return;
        }

        console.log('⏳ Aguardando grid estabilizar (max 5min)...');

        try {
            const mensagemEl = document.getElementById('mensagem-status');
            if(mensagemEl) mensagemEl.innerHTML = 'Aguardando tabela estabilizar...';
        } catch(e) {}

        let tentativasLoad = 0;
        const MAX_WAIT_SECONDS = 300;
        let linhasAnterior = 0;
        let tentativasEstavel = 0;

        while (tentativasLoad < MAX_WAIT_SECONDS) {
            forcarRemoverOverlays();
            
            const linhas = document.querySelectorAll('mat-row.mat-row');
            const linhasAtual = linhas.length;

            let linhasComDados = 0;
            linhas.forEach(function(l) {
                const id = l.querySelector('.cdk-column-vaccineId');
                if (id && id.textContent.trim()) linhasComDados++;
            });

            if (linhasComDados > 20) {
                if (linhasComDados === linhasAnterior) {
                    tentativasEstavel++;
                    if (tentativasEstavel >= 3) {
                        console.log(`✅ Grid estável com ${linhasComDados} registros com dados.`);
                        break;
                    }
                } else {
                    tentativasEstavel = 0;
                }
            }

            linhasAnterior = linhasComDados;

            if (tentativasLoad % 5 === 0 && tentativasLoad > 0) {
                console.log(`🔄 Aguardando... (${tentativasLoad}s) - Linhas com dados: ${linhasComDados}`);
                try {
                    const mensagemEl = document.getElementById('mensagem-status');
                    if(mensagemEl) mensagemEl.innerHTML = `Carregando tabela... ${tentativasLoad}s<br>Linhas com dados: ${linhasComDados}`;
                } catch(e) {}
            }

            await aguardar(1000);
            tentativasLoad++;
        }

        if (tentativasLoad >= MAX_WAIT_SECONDS) {
             console.warn('⚠️ Timeout de 5min atingido!');
             alert('⚠️ Tempo limite de 5 minutos atingido.\n\nO script tentará processar os registros disponíveis.');
        }

        await aguardar(2000);

        const analise = contarRegistrosReaisNaPagina();
        console.log('📊 Página analisada: ' + analise.total + ' linhas | ' + analise.comErro + ' com erro');

        const verificacao = verificarIdsNaPagina();
        console.log('🔍 IDs novos disponíveis: ' + verificacao.novos);

        let ultimoProcessado = totalProcessados;
        let ultimoTempo = Date.now();

        const intervaloTempo = setInterval(function() {
            const tempoDecorrido = Math.floor((Date.now() - tempoInicioProcesamento) / 1000);
            const tempoEl = document.getElementById('tempo-decorrido');
            if (tempoEl) {
                const minutos = Math.floor(tempoDecorrido / 60);
                const segs = tempoDecorrido % 60;
                tempoEl.textContent = minutos > 0 ? minutos + 'min ' + segs + 's' : tempoDecorrido + 's';
            }

            const tempoAgora = Date.now();
            const diferencaTempo = (tempoAgora - ultimoTempo) / 1000 / 60;
            const diferencaProcessados = totalProcessados - ultimoProcessado;

            if (diferencaTempo > 0) {
                velocidadeAtual = Math.round(diferencaProcessados / diferencaTempo);
                const velocidadeEl = document.getElementById('velocidade');
                if (velocidadeEl) velocidadeEl.textContent = velocidadeAtual;

                ultimoProcessado = totalProcessados;
                ultimoTempo = tempoAgora;
            }

            salvarDadosPersistentes();
            salvarDadosSessao();

            const disponiveis = contarRegistrosDisponiveis();
            atualizarProgresso(totalProcessados, disponiveis, null, totalDialogosFechados);

        }, 1000);

        let pausado = false;

        const btnPausar = document.getElementById('btn-pausar-reenvio');
        if (btnPausar) {
            btnPausar.addEventListener('click', function() {
                pausado = !pausado;
                this.textContent = pausado ? 'Continuar' : 'Pausar';
                this.style.backgroundColor = pausado ? '#4caf50' : '#ff9800';
            });
        }

        const btnCancelar = document.getElementById('btn-cancelar-reenvio');
        if (btnCancelar) {
            btnCancelar.addEventListener('click', function() {
                processosCancelados = true;
            });
        }

        const workers = [];
        for (let i = 0; i < workersMaximo; i++) {
            workers.push({
                id: i + 1,
                processando: false,
                idAtual: null
            });
        }

        while (true) {
            if (processosCancelados) {
                console.log('❌ Cancelado pelo usuário');
                const disponiveis = contarRegistrosDisponiveis();
                atualizarProgresso(totalProcessados, disponiveis, 'CANCELADO', totalDialogosFechados);
                break;
            }

            while (pausado && !processosCancelados) {
                await aguardar(500);
            }

            if (processosCancelados) break;

            let disponiveis = contarRegistrosDisponiveis();

            if (disponiveis === 0) {
                console.log('📄 Não há mais registros na página atual');
                
                if (temProximaPagina()) {
                    console.log('📄 Mudando para próxima página...');
                    const mudouPagina = await irParaProximaPagina();
                    
                    if (mudouPagina) {
                        console.log('✅ Nova página carregada! Continuando processamento...');
                        idsProcessadosNaSessaoAtual = {};
                        continue;
                    } else {
                        console.log('❌ Não foi possível mudar de página');
                        break;
                    }
                } else {
                    console.log('✅ Última página alcançada - Finalizando!');
                    atualizarProgresso(totalProcessados, 0, 'Todas as páginas processadas!', totalDialogosFechados);
                    break;
                }
            }

            const workersAUsar = Math.min(workersAtual, disponiveis);
            const registros = obterProximosRegistros(workersAUsar);

            if (registros.length === 0) {
                await aguardar(2000);
                const registrosAposAguardar = obterProximosRegistros(workersAUsar);
                if (registrosAposAguardar.length === 0) {
                    if (temProximaPagina()) {
                        console.log('📄 Sem registros aqui, tentando próxima página...');
                        const mudouPagina = await irParaProximaPagina();
                        if (mudouPagina) {
                            idsProcessadosNaSessaoAtual = {};
                            continue;
                        }
                    }
                    console.log('✅ Fim! Nenhum registro encontrado.');
                    break;
                }
                continue;
            }

            console.log('⚡ Processando lote de ' + registros.length + ' registros...');

            for (let i = 0; i < registros.length && i < workers.length; i++) {
                workers[i].processando = true;
                workers[i].idAtual = registros[i].id;
            }

            atualizarWorkersStatus(workers);
            const dispAtual = contarRegistrosDisponiveis();
            atualizarProgresso(totalProcessados, dispAtual,
                'Processando ' + registros.length + ' em paralelo (POST+GET + Sem Overlays)...',
                totalDialogosFechados);

            const promises = registros.map(function(registro, index) {
                return processarRegistro(registro, (index + 1));
            });

            const resultados = await Promise.all(promises);

            for (let i = 0; i < workers.length; i++) {
                workers[i].processando = false;
                workers[i].idAtual = null;
            }

            resultados.forEach(function(res) {
                if (res.dialogo) totalDialogosFechados++;
            });

            adaptarWorkers(resultados);
            atualizarWorkersStatus(workers);

            await aguardar(1200);

            const disponiveisApos = contarRegistrosDisponiveis();
            atualizarProgresso(totalProcessados, disponiveisApos,
                'Lote concluído',
                totalDialogosFechados);

            await aguardar(delayMs);
        }

        clearInterval(intervaloTempo);
        processandoReenvio = false;
        desinstalarSupressorOverlay();

        salvarDadosPersistentes();
        salvarDadosSessao();

        const tempoTotal = Math.floor((Date.now() - tempoInicioProcesamento) / 1000);
        console.log('🏁 Finalizado em ' + tempoTotal + 's');
        console.log('📄 Total de páginas processadas: ' + paginasProcessadas);
        console.log('🛡️ Total de overlays removidos: ' + overlaysRemovidos);

        tocarSomConclusao();
        mostrarNotificacao('✅ Reenvio Concluído', 'Processados: ' + totalProcessados + ' | Erros: ' + totalErros + ' | Páginas: ' + paginasProcessadas + ' | Overlays: ' + overlaysRemovidos);

        alert('✅ Processo finalizado!\n\nTempo: ' + tempoTotal + 's\nProcessados: ' + totalProcessados + '\nErros: ' + totalErros + '\nPáginas: ' + paginasProcessadas + '\nOverlays Removidos: ' + overlaysRemovidos);
        fecharModal();
    }

function adicionarBotaoInterface() {
    if (botaoAdicionado) return;

    const intervalo = setInterval(function() {
        let container = document.querySelector('.mat-toolbar');
        if (!container) container = document.querySelector('mat-toolbar');
        if (!container) container = document.querySelector('header');
        if (!container) container = document.querySelector('.toolbar');
        if (!container) container = document.querySelector('[role="toolbar"]');

        if (!container) {
            const bodyCheck = document.querySelector('body');
            if (bodyCheck && !document.getElementById('container-botoes-premium')) {
                container = document.createElement('div');
                container.id = 'container-botoes-premium';
                container.style.cssText = 'position: fixed; top: 10px; right: 10px; z-index: 9999; background: white; padding: 10px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
                document.body.appendChild(container);
            } else {
                container = document.getElementById('container-botoes-premium');
            }
        }

        if (container && !document.getElementById('btn-reenviar-premium')) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display: inline-flex; gap: 8px; align-items: center;';

            const botao = document.createElement('button');
            botao.id = 'btn-reenviar-premium';
            botao.innerHTML = '🛡️ Reenviar v11.11';
            botao.style.cssText = 'padding: 8px 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: transform 0.2s;';

            botao.addEventListener('mouseenter', function() {
                this.style.transform = 'scale(1.05)';
            });

            botao.addEventListener('mouseleave', function() {
                this.style.transform = 'scale(1)';
            });

            botao.addEventListener('click', function() {
                const novaSessao = detectarNovaSessao();
                if (novaSessao) {
                    const confirmar = confirm(
                        '🆕 NOVA SESSÃO DETECTADA!\n\n' +
                        'Você está em uma página/URL diferente da última execução.\n\n' +
                        'Deseja LIMPAR o histórico de sucessos antes de começar?\n\n' +
                        '✅ SIM: Reprocessa tudo na página atual\n' +
                        '❌ NÃO: Mantém histórico (pode pular registros desta página)'
                    );

                    if (confirmar) {
                        limparApenasHistoricoSucesso();
                        return;
                    }
                }

                criarModalConfiguracao();
            });

            const btnMemoria = document.createElement('button');
            btnMemoria.innerHTML = '🗑️ Limpar';
            btnMemoria.title = 'Limpar toda a memória';
            btnMemoria.style.cssText = 'padding: 8px 12px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; transition: opacity 0.2s;';
            btnMemoria.addEventListener('mouseenter', function() { this.style.opacity = '0.8'; });
            btnMemoria.addEventListener('mouseleave', function() { this.style.opacity = '1'; });
            btnMemoria.addEventListener('click', limparMemoria);

            const btnHistorico = document.createElement('button');
            btnHistorico.innerHTML = '🔄 Limpar Sucessos';
            btnHistorico.title = 'Limpar apenas histórico de sucessos';
            btnHistorico.style.cssText = 'padding: 8px 12px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; transition: opacity 0.2s;';
            btnHistorico.addEventListener('mouseenter', function() { this.style.opacity = '0.8'; });
            btnHistorico.addEventListener('mouseleave', function() { this.style.opacity = '1'; });
            btnHistorico.addEventListener('click', limparApenasHistoricoSucesso);

            const btnCopiar = document.createElement('button');
            btnCopiar.innerHTML = '📋 Stats';
            btnCopiar.title = 'Copiar estatísticas';
            btnCopiar.style.cssText = 'padding: 8px 12px; background: #2196f3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; transition: opacity 0.2s;';
            btnCopiar.addEventListener('mouseenter', function() { this.style.opacity = '0.8'; });
            btnCopiar.addEventListener('mouseleave', function() { this.style.opacity = '1'; });
            btnCopiar.addEventListener('click', copiarEstatisticas);

            const btnCSV = document.createElement('button');
            btnCSV.innerHTML = '📄 CSV';
            btnCSV.title = 'Exportar relatório CSV';
            btnCSV.style.cssText = 'padding: 8px 12px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px; transition: opacity 0.2s;';
            btnCSV.addEventListener('mouseenter', function() { this.style.opacity = '0.8'; });
            btnCSV.addEventListener('mouseleave', function() { this.style.opacity = '1'; });
            btnCSV.addEventListener('click', exportarRelatorioCSV);

            wrapper.appendChild(botao);
            wrapper.appendChild(btnMemoria);
            wrapper.appendChild(btnHistorico);
            wrapper.appendChild(btnCopiar);
            wrapper.appendChild(btnCSV);

            container.appendChild(wrapper);

            botaoAdicionado = true;
            clearInterval(intervalo);

            console.log('✅ Botões v11.11 adicionados com sucesso!');
            console.log('📍 Local: ' + (container.id || container.className || 'container genérico'));
        }
    }, 1000);

    setTimeout(function() {
        if (!botaoAdicionado) {
            console.warn('⚠️ Toolbar não encontrada após 30s, criando container fixo...');
            clearInterval(intervalo);

            const containerFixo = document.createElement('div');
            containerFixo.id = 'container-botoes-premium';
            containerFixo.style.cssText = 'position: fixed; top: 10px; right: 10px; z-index: 99999; background: white; padding: 10px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
            document.body.appendChild(containerFixo);

            botaoAdicionado = false;
            adicionarBotaoInterface();
        }
    }, 30000);
}


    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', adicionarBotaoInterface);
    } else {
        adicionarBotaoInterface();
    }

    carregarDadosPersistentes();

})();
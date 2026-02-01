// ==UserScript==
// @name         SIGSS Diferenciador AG/DI - Otimizado Paralelo (FIX)
// @namespace    http://tampermonkey.net/
// @author       Renato Krebs Rosa
// @version      19.3
// @description  Diferencia agendamentos (AG) de demanda imediata (DI) com requisições paralelas controladas
// @match        *://*/sigss/atendimentoConsultaAgenda*
// @match        *://*/sigss/atendimentoOdontoAgenda*
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/sigss-diferenciador-ag-di.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/sigss-diferenciador-ag-di.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = true;
    const CONCURRENCY = 20;
    const BATCH_DELAY = 50;

    function log(...args) { if (DEBUG) console.log('[AG/DI]', ...args); }

    // ========== ESTILOS ==========
    const STYLES = `
    .btn-sigss-compact{
        padding:6px 12px;
        border:1px solid transparent;
        border-radius:4px;
        cursor:pointer;
        font-size:11px;
        font-weight:bold;
        color:white;
        display:inline-flex;
        align-items:center;
        justify-content:center; /* 👈 garante centralização */
        gap:4px;
        height:30px;
        transition:background 0.2s;
        text-transform:uppercase;
        font-family:sans-serif;
        text-decoration:none;
        margin-left:5px;
        box-sizing:border-box
    }
    .btn-agdi{
        background-color:#FF9800;
        border-color:#F57C00
    }
    .btn-agdi:hover{
        background-color:#FB8C00
    }
    .btn-agdi-odonto{
        width:100%!important;
        height:28px!important;
        margin:0!important;
        margin-top:5px!important
    }
    #agdi-config-modal{
        position:fixed;
        top:0;
        left:0;
        width:100%;
        height:100%;
        background-color:rgba(0,0,0,0.5);
        z-index:10001;
        display:none;
        justify-content:center;
        align-items:center;
        font-family:sans-serif
    }
    .indicador-agendamento{
        float:right;
        margin-left:5px;
        padding:2px 6px;
        border-radius:3px;
        font-size:10px;
        font-weight:bold;
        cursor:help;
        text-transform:uppercase;
        color:white
    }`;

    // ========== CONFIG ==========
    const CONFIG_KEY = 'agdi_palavras_chave';
    const DEFAULT_PALAVRAS = ['SEM AGENDAMENTO'];
    const loadConfig = () => { try { const s = localStorage.getItem(CONFIG_KEY); return s ? JSON.parse(s) : DEFAULT_PALAVRAS; } catch(e){ return DEFAULT_PALAVRAS; } };
    const saveConfig = (p) => localStorage.setItem(CONFIG_KEY, JSON.stringify(p));
    let PALAVRAS = loadConfig();

    // ========== URL FIXA ==========
    const CONSULTA_BASE_URL = (() => {
        const url = new URL(window.location.href);
        return `${url.origin}/sigss/atendimentoConsultaAgenda`;
    })();

    // ========== CACHE E CONTROLE ==========
    const mapCache = new Map();
    const pendingFetches = new Map();
    let isRunning = false;

    // ========== UI ==========
    function injectStyles() {
        if (!document.getElementById('style-agdi')) {
            const s = document.createElement('style');
            s.id = 'style-agdi';
            s.textContent = STYLES;
            document.head.appendChild(s);
        }
    }

    function createButton() {
        if (document.getElementById('agdi-config-btn')) return;

        const legendOdonto = document.querySelector('fieldset.sigss-container legend.sigss-font--large');
        if (legendOdonto) {
            log('🦷 Modo Odonto detectado');
            const btn = document.createElement('button');
            btn.id = 'agdi-config-btn';
            btn.className = 'btn-sigss-compact btn-agdi btn-agdi-odonto';
            btn.innerHTML = '⚙️ AG/DI';
            btn.type = 'button';
            btn.onclick = (e) => { e.preventDefault(); openModal(); };
            legendOdonto.parentElement.appendChild(btn);
            return;
        }

        const inputNome = document.getElementById('usuarioServicoNome');
        if (inputNome) {
            log('📋 Modo Consulta detectado');
            const row = inputNome.closest('tr') || inputNome.parentElement.parentElement;
            if (row) {
                const btn = document.createElement('button');
                btn.id = 'agdi-config-btn';
                btn.className = 'btn-sigss-compact btn-agdi';
                btn.innerHTML = '⚙️ AG/DI';
                btn.type = 'button';
                btn.onclick = (e) => { e.preventDefault(); openModal(); };
                row.style.display = 'flex';
                row.style.alignItems = 'flex-end';
                row.appendChild(btn);
            }
        }
    }

    function openModal() {
        let m = document.getElementById('agdi-config-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'agdi-config-modal';
            m.innerHTML = `
                <div style="background:white;padding:25px;border-radius:8px;width:500px;box-shadow:0 4px 15px rgba(0,0,0,0.3);">
                    <h2 style="margin:0 0 15px 0;color:#333;">⚙️ Configuração AG/DI</h2>
                    <p style="margin-bottom:10px;color:#666;">Consultas são marcadas como DI se foram agendas marcando o combobox DI ou se o nome do turno contiver as palavras-chave abaixo.\nPalavras-chave (uma por linha):</p>
                    <textarea id="agdi-txt" style="width:100%;height:150px;padding:8px;border:1px solid #ddd;font-family:monospace;"></textarea>
                    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:15px;">
                        <button id="agdi-cancel" style="padding:8px 15px;background:#eee;border:none;border-radius:4px;cursor:pointer;">Cancelar</button>
                        <button id="agdi-save" style="padding:8px 15px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;">Salvar</button>
                    </div>
                </div>`;
            document.body.appendChild(m);

            m.querySelector('#agdi-cancel').onclick = () => m.style.display = 'none';
            m.querySelector('#agdi-save').onclick = () => {
                const v = m.querySelector('#agdi-txt').value.split('\\n').map(x=>x.trim()).filter(x=>x);
                if(v.length){
                    PALAVRAS = v;
                    saveConfig(v);
                    m.style.display = 'none';
                    mapCache.clear();
                    pendingFetches.clear();
                    document.querySelectorAll('.indicador-agendamento').forEach(e => e.remove());
                    runCheck();
                }
            };
        }
        m.querySelector('#agdi-txt').value = PALAVRAS.join('\\n');
        m.style.display = 'flex';
    }

    // ========== LÓGICA ==========
    function isDI(dto) {
        if (!dto.infoNomeTurno) return true;
        const n = dto.infoNomeTurno.toUpperCase();
        return PALAVRAS.some(p => n.includes(p.toUpperCase()));
    }

    function fetchInfo(pk) {
        if (mapCache.has(pk)) return Promise.resolve(mapCache.get(pk));
        if (pendingFetches.has(pk)) return pendingFetches.get(pk);

        const promise = new Promise((resolve, reject) => {
            const [idp, ids] = pk.split('-');
            const xhr = new XMLHttpRequest();
            const url = `${CONSULTA_BASE_URL}/getInfoRegistro?agcoPK.idp=${idp}&agcoPK.ids=${ids}`;

            xhr.open('GET', url, true);
            xhr.timeout = 10000;
            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const r = JSON.parse(xhr.responseText);
                        const dto = r.atendimentoConsultaInfoDialogDTO || r.atendimentoOdontoInfoDialogDTO || r;
                        const nomeTurno = dto.infoNomeTurno || dto.nomeTurno || 'Turno Desconhecido';
                        const di = isDI(dto);
                        const info = {
                            type: di ? 'DI' : 'AG',
                            label: di ? 'Demanda Imediata' : `Agendado: ${nomeTurno}`
                        };
                        mapCache.set(pk, info);
                        resolve(info);
                    } catch (e) { reject(e); }
                } else {
                    reject(xhr.status);
                }
            };
            xhr.onerror = () => reject('network');
            xhr.ontimeout = () => reject('timeout');
            xhr.send();
        }).finally(() => {
            pendingFetches.delete(pk);
        });

        pendingFetches.set(pk, promise);
        return promise;
    }

    function draw(cell, info) {
        if (cell.querySelector('.indicador-agendamento')) return;
        const s = document.createElement('span');
        s.className = 'indicador-agendamento';
        s.textContent = info.type;
        s.title = info.label;
        s.style.backgroundColor = info.type === 'AG' ? '#4CAF50' : '#FF9800';

        const container = cell.querySelector('.layout-row') || cell;
        container.appendChild(s);
    }

    // ========== PROCESSAMENTO PARALELO ==========
    async function runCheck() {
        if (isRunning) return;
        isRunning = true;

        const rows = document.querySelectorAll('tr[id]');
        const toFetch = [];

        // Coleta o que precisa buscar
        for (const tr of rows) {
            const pid = tr.id;
            if (!pid || !pid.includes('-')) continue;

            const cell = tr.querySelector('td[aria-describedby*="entiNome"], td[aria-describedby*="usuarioServicoNome"], td[aria-describedby*="Nome"], td[aria-describedby*="paciente"]');
            if (!cell || cell.querySelector('.indicador-agendamento')) continue;

            // Se já tem em cache, desenha imediatamente
            if (mapCache.has(pid)) {
                draw(cell, mapCache.get(pid));
            } else if (!pendingFetches.has(pid)) {
                toFetch.push({pid, cell});
            }
        }

        if (toFetch.length === 0) {
            isRunning = false;
            return;
        }

        log(`Processando ${toFetch.length} requisições em batches de ${CONCURRENCY}`);

        // Processa em batches
        for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
            const batch = toFetch.slice(i, i + CONCURRENCY);

            await Promise.allSettled(
                batch.map(item =>
                    fetchInfo(item.pid)
                        .then(info => {
                            if (document.body.contains(item.cell)) {
                                draw(item.cell, info);
                            }
                        })
                        .catch(err => {
                            if (DEBUG) log(`Erro ao buscar ${item.pid}:`, err);
                        })
                )
            );

            if (i + CONCURRENCY < toFetch.length) {
                await new Promise(r => setTimeout(r, BATCH_DELAY));
            }
        }

        isRunning = false;
        log('Processamento concluído');
    }

    function debounce(fn, ms) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    // ========== BOOT ==========
    injectStyles();

    const debouncedRunCheck = debounce(runCheck, 300);
    const mo = new MutationObserver((mutations) => {
        const hasNewRows = mutations.some(m =>
            Array.from(m.addedNodes).some(n => n.nodeType === 1 && (n.matches?.('tr[id]') || n.querySelector?.('tr[id]')))
        );
        if (hasNewRows) debouncedRunCheck();
    });

    const initInterval = setInterval(() => {
        createButton();

        const grid = document.querySelector('#grid_busca') || document.querySelector('table.ui-jqgrid-btable');
        if (grid && !grid.dataset.agdiObserved) {
            grid.dataset.agdiObserved = '1';
            log('Grid detectado, iniciando observador');

            const tbody = grid.querySelector('tbody') || grid;
            mo.observe(tbody, { childList: true, subtree: false });

            runCheck();
        }
    }, 1000);

})();

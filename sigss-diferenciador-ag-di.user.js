// ==UserScript==
// @name         SIGSS Diferenciador AG／DI - Automático (Multi-Context) FIX
// @namespace    http://tampermonkey.net/
// @version      18.1
// @description  Diferencia agendamentos (AG) de demanda imediata (DI) usando sempre a URL de Consulta
// @match        *://*/sigss/atendimentoConsultaAgenda*
// @match        *://*/sigss/atendimentoOdontoAgenda*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = true;
    function log(...args) { if (DEBUG) console.log('[AG/DI]', ...args); }

    // ========== ESTILOS ==========
    const STYLES = `
        .btn-sigss-compact {
            padding: 6px 12px; border: 1px solid transparent; border-radius: 4px;
            cursor: pointer; font-size: 11px; font-weight: bold; color: white;
            display: inline-flex; align-items: center; gap: 4px; height: 30px;
            transition: background 0.2s; text-transform: uppercase; font-family: sans-serif;
            text-decoration: none; margin-left: 5px;
        }
        .btn-agdi { background-color: #FF9800; border-color: #F57C00; }
        .btn-agdi:hover { background-color: #FB8C00; }

        .btn-agdi-odonto {
            height: 35px;
            margin-top: 5px;
            vertical-align: middle;
        }

        #agdi-config-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.5); z-index: 10001; display: none;
            justify-content: center; align-items: center; font-family: sans-serif;
        }
    `;

    // ========== CONFIG ==========
    const CONFIG_KEY = 'agdi_palavras_chave';
    const DEFAULT_PALAVRAS = ['SEM AGENDAMENTO'];
    function loadConfig() { try { const s = localStorage.getItem(CONFIG_KEY); return s ? JSON.parse(s) : DEFAULT_PALAVRAS; } catch(e){ return DEFAULT_PALAVRAS; } }
    function saveConfig(p) { localStorage.setItem(CONFIG_KEY, JSON.stringify(p)); }
    let PALAVRAS = loadConfig();

    // ========== URL FIXA DE CONSULTA ==========
    // Sempre usar o mesmo endpoint, mesmo estando na tela de Odonto:
    //   *host*/sigss/atendimentoConsultaAgenda/getInfoRegistro
    function getConsultaBaseUrl() {
        const url = new URL(window.location.href);
        return `${url.origin}/sigss/atendimentoConsultaAgenda`;
    }

    // ========== UI ENGINE ==========
    function injectStyles() {
        if (!document.getElementById('style-agdi')) {
            const s = document.createElement('style'); s.id = 'style-agdi'; s.textContent = STYLES;
            document.head.appendChild(s);
        }
    }

    function createButton() {
        if (document.getElementById('agdi-config-btn')) return;

        // Odonto
        const fieldsetOdonto = document.querySelector('fieldset.sigss-container legend.sigss-font--large');
        if (fieldsetOdonto) {
            log('🦷 Detectado modo Odonto');
            const container = fieldsetOdonto.parentElement;

            const btn = document.createElement('button');
            btn.id = 'agdi-config-btn';
            btn.className = 'btn-sigss-compact btn-agdi btn-agdi-odonto';
            btn.innerHTML = '<i class="ui-icon ui-icon-gear" style="display:inline-block;margin-right:4px;"></i> Config AG/DI';
            btn.type = 'button';
            btn.onclick = (e) => { e.preventDefault(); openModal(); };

            container.appendChild(btn);
            return;
        }

        // Consulta
        const inputNome = document.getElementById('usuarioServicoNome');
        if (inputNome) {
            log('📋 Detectado modo Consulta');
            const row = inputNome.parentElement.parentElement;

            const btn = document.createElement('button');
            btn.id = 'agdi-config-btn';
            btn.className = 'btn-sigss-compact btn-agdi';
            btn.innerHTML = '⚙️ AG/DI';
            btn.type = 'button';
            btn.onclick = (e) => { e.preventDefault(); openModal(); };

            if (getComputedStyle(row).display !== 'flex') {
                row.style.display = 'flex'; row.style.alignItems = 'flex-end';
            } else {
                row.style.alignItems = 'flex-end';
            }

            row.appendChild(btn);
        }
    }

    function openModal() {
        let m = document.getElementById('agdi-config-modal');
        if (!m) {
            m = document.createElement('div'); m.id = 'agdi-config-modal';
            m.innerHTML = `
                <div style="background:white;padding:25px;border-radius:8px;width:500px;box-shadow:0 4px 15px rgba(0,0,0,0.3);">
                    <h2 style="margin:0 0 15px 0;color:#333;">⚙️ Configuração AG/DI</h2>
                    <p style="margin-bottom:10px;color:#666;">Palavras-chave (uma por linha):</p>
                    <textarea id="agdi-txt" style="width:100%;height:150px;padding:8px;border:1px solid #ddd;"></textarea>
                    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:15px;">
                        <button id="agdi-cancel" style="padding:8px 15px;background:#eee;border:none;border-radius:4px;cursor:pointer;">Cancelar</button>
                        <button id="agdi-save" style="padding:8px 15px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;">Salvar</button>
                    </div>
                </div>`;
            document.body.appendChild(m);
            m.querySelector('#agdi-cancel').onclick = () => m.style.display = 'none';
            m.querySelector('#agdi-save').onclick = () => {
                const v = m.querySelector('#agdi-txt').value.split('\n').map(x=>x.trim()).filter(x=>x);
                if(v.length){
                    PALAVRAS=v; saveConfig(v); m.style.display='none';
                    document.querySelectorAll('.indicador-agendamento').forEach(e=>e.remove());
                    mapCache.clear(); runCheck();
                }
            };
        }
        m.querySelector('#agdi-txt').value = PALAVRAS.join('\n');
        m.style.display = 'flex';
    }

    // ========== LOGIC ==========
    const mapCache = new Map();
    let isRunning = false;

    function isDI(dto) {
        if (!dto.infoNomeTurno) return true;
        const n = dto.infoNomeTurno.toUpperCase();
        return PALAVRAS.some(p => n.includes(p.toUpperCase()));
    }

    function fetchInfo(pk) {
        return new Promise((ok, fail) => {
            const [idp, ids] = pk.split('-');
            const xhr = new XMLHttpRequest();

            const baseUrl = getConsultaBaseUrl();
            const url = `${baseUrl}/getInfoRegistro?agcoPK.idp=${idp}&agcoPK.ids=${ids}`;
            log('XHR URL:', url);

            xhr.open('GET', url, true);
            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const r = JSON.parse(xhr.responseText);
                        const dto = r.atendimentoConsultaInfoDialogDTO || r.atendimentoOdontoInfoDialogDTO || r;
                        const nomeTurno = dto.infoNomeTurno || dto.nomeTurno || 'Turno Desconhecido';
                        const di = isDI(dto);
                        const info = { type: di ? 'DI' : 'AG', label: di ? 'Demanda Imediata' : `Agendado: ${nomeTurno}` };
                        mapCache.set(pk, info);
                        ok(info);
                    } catch (e) { fail(e); }
                } else {
                    log('XHR status != 200:', xhr.status);
                    fail(xhr.status);
                }
            };
            xhr.onerror = () => fail('network');
            xhr.send();
        });
    }

    function runCheck() {
        if (isRunning) return; isRunning = true;
        try {
            document.querySelectorAll('tr[id]').forEach(tr => {
                const pid = tr.id;
                if (!pid || !pid.includes('-')) return;

                const cell = tr.querySelector('td[aria-describedby*="entiNome"], td[aria-describedby*="usuarioServicoNome"], td[aria-describedby*="Nome"], td[aria-describedby*="paciente"]');
                if (!cell || cell.querySelector('.indicador-agendamento')) return;

                if (mapCache.has(pid)) {
                    draw(cell, mapCache.get(pid));
                } else {
                    fetchInfo(pid).then(i => {
                        const c = document.getElementById(pid)?.querySelector('td[aria-describedby*="entiNome"], td[aria-describedby*="usuarioServicoNome"], td[aria-describedby*="Nome"], td[aria-describedby*="paciente"]');
                        if (c) draw(c, i);
                    }).catch(()=>{});
                }
            });
        } finally { isRunning = false; }
    }

    function draw(cell, info) {
        if (cell.querySelector('.indicador-agendamento')) return;
        const s = document.createElement('span');
        s.className = 'indicador-agendamento';
        s.textContent = info.type;
        s.title = info.label;
        s.style.cssText = `float:right;margin-left:5px;padding:1px 5px;background:${info.type==='AG'?'#4CAF50':'#FF9800'};color:white;border-radius:3px;font-size:10px;font-weight:bold;cursor:help;`;
        (cell.querySelector('.layout-row')||cell).appendChild(s);
    }

    // ========== BOOT ==========
    injectStyles();
    const mo = new MutationObserver(runCheck);

    setInterval(() => {
        createButton();
        const g = document.querySelector('#grid_busca') || document.querySelector('table.ui-jqgrid-btable');
        if (g && !g.hasAttribute('d-obs')) {
            g.setAttribute('d-obs', '1');
            mo.observe(g.parentElement, { childList: true, subtree: true });
            runCheck();
        }
    }, 1000);

})();

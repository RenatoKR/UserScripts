// ==UserScript==
// @name         SIGSS - Visualizar Todas as Agendas V28.5 (Fix NullPointer)
// @namespace    http://tampermonkey.net/
// @version      28.5
// @description  Fix para NullPointerException ao trocar agenda
// @author       Renato Krebs Rosa
// @match        *://*/sigss/atendimentoConsultaAgenda*
// @match        *://*/sigss/atendimentoOdontoAgenda*
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/SIGSS-Visualizar-Todas-as-Agendas.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/SIGSS-Visualizar-Todas-as-Agendas.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'sigss_saved_doctors';
    const STORAGE_FREQ_KEY = 'sigss_refresh_frequency';
    const DEBUG = false;

    let refreshInterval = parseInt(localStorage.getItem(STORAGE_FREQ_KEY)) || 30000;
    let originalGridConfig = { datatype: 'json', url: '', postData: {} };
    let isMultiViewActive = false;
    let autoRefreshTimer = null;
    let statusUpdateTimer = null;
    let currentTargets = [];
    let savedBaseParams = null;
    let lastUpdate = null;
    let isPaused = false;

    function log(...args) {
        if (DEBUG) console.log('[SIGSS Auto-Refresh]', ...args);
    }

    const CONTEXT = {
        isOdonto: window.location.href.includes('atendimentoOdontoAgenda'),
        profSelectIds: [
            '#agco\\.profissionalDestino\\.prsaPK',
            '#agod\\.profissionalDestino\\.prsaPK',
            'select[name*="profissionalDestino"]'
        ]
    };

    const STYLES = `
        .sigss-toolbar-universal {
            display: inline-flex; gap: 5px; align-items: center; margin-left: 5px; vertical-align: middle;
        }

        .btn-sigss-compact {
            padding: 0 12px; border: 1px solid transparent; border-radius: 4px;
            cursor: pointer; font-size: 11px; font-weight: bold; color: white;
            display: inline-flex; align-items: center; justify-content: center; gap: 4px;
            transition: background 0.2s; text-transform: uppercase; font-family: sans-serif;
            height: 30px; box-sizing: border-box;
        }

        .sigss-toolbar-odonto {
            display: flex !important; flex-direction: column !important;
            width: 100% !important; margin-left: 0 !important;
            gap: 4px !important; margin-top: 5px;
        }

        .btn-sigss-odonto {
            width: 100% !important; height: 28px !important;
            font-size: 11px !important; margin: 0 !important;
        }

        .btn-quick { background-color: #4CAF50; border-color: #388E3C; }
        .btn-quick:hover { background-color: #43A047; }
        .btn-config { background-color: #2196F3; border-color: #1976D2; }
        .btn-config:hover { background-color: #1E88E5; }

        #sigss-selector-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9998; display: none; justify-content: center; align-items: center; }
        #sigss-selector-content { background: white; width: 500px; max-height: 80vh; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); display: flex; flex-direction: column; font-family: sans-serif; }
        .sigss-header { padding: 15px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; background: #f5f5f5; border-radius: 8px 8px 0 0; }
        .sigss-body { padding: 10px; overflow-y: auto; flex: 1; }
        .sigss-item { display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #eee; cursor: pointer; font-size: 13px; }
        .sigss-item:hover { background: #e3f2fd; }
        .sigss-item input { margin-right: 10px; cursor: pointer; }
        .sigss-footer { padding: 15px; border-top: 1px solid #ddd; display: flex; justify-content: flex-end; gap: 10px; background: #fff; border-radius: 0 0 8px 8px; }
        .btn-modal { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .btn-cancel { background: #e0e0e0; color: #333; }
        .btn-confirm { background: #2196F3; color: white; }

        /* Barra fina e discreta */
        #sigss-status-bar {
            background: #fafafa;
            border: 1px solid #e0e0e0;
            border-left: 3px solid #4CAF50;
            padding: 6px 12px;
            margin-top: 8px;
            margin-bottom: 8px;
            border-radius: 3px;
            display: flex;
            align-items: center;
            gap: 12px;
            font-family: sans-serif;
            font-size: 11px;
        }
        #sigss-status-bar.paused { border-left-color: #FF9800; }

        .sigss-status-text {
            flex: 1;
            color: #666;
            font-weight: 500;
        }

        .sigss-status-btn {
            background: transparent;
            border: 1px solid transparent;
            border-radius: 2px;
            cursor: pointer;
            font-size: 14px;
            padding: 2px 6px;
            color: #666;
            transition: all 0.2s;
            line-height: 1;
        }
        .sigss-status-btn:hover {
            background: #f0f0f0;
            border-color: #ddd;
        }

        .sigss-pulse-small {
            display: inline-block;
            width: 6px;
            height: 6px;
            background: #4CAF50;
            border-radius: 50%;
            margin-right: 6px;
            animation: pulse 2s infinite;
        }
        .sigss-pulse-small.paused {
            background: #FF9800;
            animation: none;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }

        /* Modal compacto */
        #sigss-freq-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            z-index: 9999;
            display: none;
            font-family: sans-serif;
            min-width: 280px;
        }
        #sigss-freq-modal h3 {
            margin: 0 0 15px 0;
            font-size: 15px;
            color: #333;
        }
        #sigss-freq-modal label {
            display: block;
            margin-bottom: 5px;
            font-size: 12px;
            color: #666;
        }
        #sigss-freq-modal input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 13px;
            margin-bottom: 15px;
            box-sizing: border-box;
        }
        #sigss-freq-modal .btn-group {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        .freq-info {
            font-size: 11px;
            color: #999;
            margin-bottom: 10px;
        }
    `;

    const checkReady = setInterval(() => {
        if (window.jQuery && window.jQuery('#grid_busca').length) {
            clearInterval(checkReady);
            init();
        }
    }, 1000);

    function init() {
        const $ = window.jQuery;
        const $grid = $('#grid_busca');
        $('head').append(`<style>${STYLES}</style>`);

        originalGridConfig.datatype = $grid.jqGrid('getGridParam', 'datatype');
        originalGridConfig.url = $grid.jqGrid('getGridParam', 'url');
        // ★ SOLUÇÃO 3: Resolver funções imediatamente ao salvar
        originalGridConfig.postData = resolveGridParams($, $grid);

        injectUI($); 
        createModalHTML($); 
        createFreqModal($);

        const $profSelect = getProfSelect($);
        if ($profSelect.length) $profSelect.on('change', () => { stopAutoRefresh(true); restoreGrid($); updateBadge($); });
        $('#botao_pesquisar, button[onclick*="pesquisar"]').on('click', () => { stopAutoRefresh(true); restoreGrid($); });

        log('✅ Script inicializado');
    }

    function getProfSelect($) {
        for (let sel of CONTEXT.profSelectIds) if ($(sel).length) return $(sel);
        return $();
    }

    function cleanProfName(text) {
        if (!text) return '';
        let name = text.includes('—') ? text.split('—')[1] : (text.includes('-') ? text.split('-')[1] || text : text);
        name = name.replace(/img\/.*\.png/gi, '').replace(/\.png|\.jpg|\.gif/gi, '');
        name = name.replace(/\d{2}:\d{2}$/, '');
        return name.trim();
    }

    function injectUI($) {
        if ($('#sigss-custom-toolbar').length) return;
        const savedCount = getSavedCount($);
        const containerClass = CONTEXT.isOdonto ? 'sigss-toolbar-odonto' : 'sigss-toolbar-universal';
        const btnClass = CONTEXT.isOdonto ? 'btn-sigss-odonto' : '';

        const $toolbar = $(`
            <div id="sigss-custom-toolbar" class="${containerClass}">
                <button id="btn-sigss-quick" class="btn-sigss-compact btn-quick ${btnClass}" title="Carregar salvos">
                    🚀 Carregar (<span id="sigss-count-badge">${savedCount}</span>)
                </button>
                <button id="btn-sigss-config" class="btn-sigss-compact btn-config ${btnClass}" title="Selecionar">
                    ⚙️ Selecionar
                </button>
            </div>
        `);

        if (CONTEXT.isOdonto) {
            const $fieldset = $('fieldset.sigss-container');
            if ($fieldset.length) {
                $fieldset.append($toolbar);
                bindEvents($);
                return;
            }
        }

        const $target = $('#divUsuarioServicoNome').parent();
        if ($target.length) {
            $target.append($toolbar);
            if ($target.css('display') !== 'flex') $target.css({ 'display': 'flex', 'align-items': 'flex-end' });
            else $target.css({ 'align-items': 'flex-end' });
            bindEvents($);
        }
    }

    function bindEvents($) {
        $('#btn-sigss-quick').click((e) => { e.preventDefault(); quickLoad($); });
        $('#btn-sigss-config').click((e) => { e.preventDefault(); openSelector($); });
    }

    function getSavedList() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; } }
    function saveList(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    function getSavedCount($) { let c=0; const s=getSavedList(); getProfSelect($).find('option').each(function(){ if(s.includes($(this).val())) c++; }); return c; }
    function updateBadge($) { $('#sigss-count-badge').text(getSavedCount($)); }

    function quickLoad($) {
        const savedIds = getSavedList();
        if (!savedIds.length) return alert('Nenhuma agenda salva.');
        const target = [];
        getProfSelect($).find('option').each(function() {
            const val = $(this).val();
            if (savedIds.includes(val)) {
                target.push({ idp: val.split('-')[0], ids: val.split('-')[1], nome: cleanProfName($(this).text()), full: val });
            }
        });
        if (!target.length) return alert('Nenhum profissional salvo nesta unidade.');
        runScript(target);
    }

    function createModalHTML($) {
        if ($('#sigss-selector-modal').length) return;
        $('body').append(`<div id="sigss-selector-modal"><div id="sigss-selector-content"><div class="sigss-header"><h3 style="margin:0">Agendas Múltiplas</h3><div style="font-size:12px"><a href="#" id="sigss-check-all">Todos</a> | <a href="#" id="sigss-check-none">Nenhum</a></div></div><div class="sigss-body" id="sigss-list"></div><div class="sigss-footer"><button class="btn-modal btn-cancel" id="sigss-btn-close">Fechar</button><button class="btn-modal btn-confirm" id="sigss-btn-save-run">Salvar e Carregar</button></div></div></div>`);
        $('#sigss-btn-close').click(() => $('#sigss-selector-modal').hide());
        $('#sigss-check-all').click((e) => { e.preventDefault(); $('.sigss-chk').prop('checked', true); });
        $('#sigss-check-none').click((e) => { e.preventDefault(); $('.sigss-chk').prop('checked', false); });
        $('#sigss-btn-save-run').click(() => {
            const sels = [], ids = [];
            $('.sigss-chk:checked').each(function() {
                const val = $(this).val();
                ids.push(val); sels.push({ idp: val.split('-')[0], ids: val.split('-')[1], nome: $(this).data('name'), full: val });
            });
            if (!sels.length) return alert('Selecione um.');
            saveList(ids); updateBadge($); $('#sigss-selector-modal').hide(); runScript(sels);
        });
    }

    function createFreqModal($) {
        const currentSec = Math.floor(refreshInterval / 1000);
        $('body').append(`
            <div id="sigss-freq-modal">
                <h3>⚙️ Frequência de Atualização</h3>
                <label>Intervalo em segundos (1-999):</label>
                <input type="number" id="sigss-freq-input" min="1" max="999" value="${currentSec}" />
                <div class="freq-info">Ex: 30 = atualizar a cada 30 segundos</div>
                <div class="btn-group">
                    <button class="btn-modal btn-cancel" id="sigss-freq-cancel">Cancelar</button>
                    <button class="btn-modal btn-confirm" id="sigss-freq-save">Salvar</button>
                </div>
            </div>
        `);

        $('#sigss-freq-cancel').click((e) => {
            e.preventDefault();
            $('#sigss-freq-modal').hide();
        });

        $('#sigss-freq-save').click((e) => {
            e.preventDefault();
            const seconds = parseInt($('#sigss-freq-input').val()) || 30;
            const clamped = Math.max(1, Math.min(999, seconds));
            refreshInterval = clamped * 1000;
            localStorage.setItem(STORAGE_FREQ_KEY, refreshInterval);
            $('#sigss-freq-modal').hide();

            if (isMultiViewActive) {
                stopAutoRefresh(false);
                startAutoRefresh($);
                updateStatusBar();
                updateFreqIndicator();
            }
        });
    }

    function openSelector($) {
        const $list = $('#sigss-list'); $list.empty(); const saved = getSavedList(); let c = 0;
        getProfSelect($).find('option').each(function() {
            const val = $(this).val();
            if (val && val.includes('-') && val !== '0') {
                const name = cleanProfName($(this).text());
                const chk = saved.includes(val) ? 'checked' : '';
                $list.append(`<label class="sigss-item"><input type="checkbox" class="sigss-chk" value="${val}" data-name="${name}" ${chk}><span>${name}</span></label>`); c++;
            }
        });
        if (!c) return alert('Nenhum profissional listado.');
        $('#sigss-selector-modal').css('display', 'flex');
    }

    async function runScript(targets) {
        log('🚀 runScript iniciado');
        const $ = window.jQuery; const $grid = $('#grid_busca');
        try {
            let u = $grid.jqGrid('getGridParam','url');
            if(!originalGridConfig.url && u) {
                originalGridConfig.url=u;
                originalGridConfig.postData=resolveGridParams($, $grid);
            }
            if(!originalGridConfig.url) return alert('Erro URL grid.');

            currentTargets = targets;
            patchGrid($grid);

            const raw = resolveGridParams($, $grid);
            savedBaseParams = $.extend(true, {}, raw);

            showUI(true, targets.length);
            $grid.jqGrid('setGridParam',{datatype:'local',data:[]}).trigger('reloadGrid');

            let allRows = await fetchAllData($, targets);
            showUI(false);

            $grid.jqGrid('setGridParam', {
                datatype: 'local',
                data: allRows,
                rowNum: 5000,
                sortname: '',
                sortorder: 'asc'
            }).trigger('reloadGrid');

            $('#sp_1_grid_busca_pager').text(allRows.length);
            isMultiViewActive = true;
            lastUpdate = new Date();

            startAutoRefresh($);
            showStatusBar($);

            setTimeout(() => { window.dispatchEvent(new Event('scroll')); }, 500);
        } catch (e) {
            showUI(false);
            alert('Erro: ' + e.message);
            restoreGrid($);
        }
    }

    async function fetchAllData($, targets) {
        const colModel = $('#grid_busca').jqGrid('getGridParam','colModel');
        let allRows = [];

        for (let i = 0; i < targets.length; i++) {
            const prof = targets[i];
            updateUI(i+1, prof.nome);

            try {
                let apcnId = '';
                try {
                    const unsaIdp = get(savedBaseParams, 'unsaIdp') || '1001';
                    const unsaIds = get(savedBaseParams, 'unsaIds') || '1';
                    const r = await $.post('atividadeProfissionalCnes/buscaPorUnsaPrsaPadrao', {
                        'unsaPK.idp': unsaIdp,
                        'unsaPK.ids': unsaIds,
                        'prsaPK.idp': prof.idp,
                        'prsaPK.ids': prof.ids
                    });
                    if(Array.isArray(r)&&r.length) apcnId=r[0][0];
                    else if(r?.apcnId) apcnId=r.apcnId;
                }catch(e){}

                const res = await fetchWithOriginalUrl($, originalGridConfig.url, prof, apcnId);

                if (res && res.rows) {
                    const mapped = res.rows.map(r => {
                        const obj = { id: r.id + '-' + prof.idp, _profId: prof.idp };
                        let idx = 0;
                        colModel.forEach(col => {
                            if (['rn', 'cb', 'subgrid'].includes(col.name)) return;
                            let val = r.cell[idx] ?? "";
                            if (typeof val === 'string' && val.includes('<div') && !val.includes(prof.nome)) {
                                 val = `<div style="background:transparent;color:#01579B;font-size:10px;font-weight:bold;border-bottom:1px dashed #B0BEC5;padding-bottom:1px;margin-bottom:2px;text-transform:uppercase;">${prof.nome}</div>` + val;
                            }
                            obj[col.name] = val; idx++;
                        });
                        return obj;
                    });
                    allRows = allRows.concat(mapped);
                }
            } catch (e) {}
        }
        return allRows;
    }

    function startAutoRefresh($) {
        stopAutoRefresh(false);
        isPaused = false;

        autoRefreshTimer = setInterval(async () => {
            if (isPaused || !isMultiViewActive) return;

            updateStatusBar('⟳ Atualizando...');

            try {
                const newData = await fetchAllData($, currentTargets);
                mergeGridData($, newData);
                lastUpdate = new Date();
                updateStatusBar();
            } catch (e) {
                updateStatusBar('❌ Erro');
            }
        }, refreshInterval);

        statusUpdateTimer = setInterval(() => {
            if (isMultiViewActive && !isPaused) updateStatusBar();
        }, 1000);
    }

    function stopAutoRefresh(fullStop = true) {
        if (autoRefreshTimer) clearInterval(autoRefreshTimer);
        if (statusUpdateTimer) clearInterval(statusUpdateTimer);
        autoRefreshTimer = null;
        statusUpdateTimer = null;

        if (fullStop) {
            $('#sigss-status-bar').remove();
            isMultiViewActive = false;
            savedBaseParams = null;
        }
    }

    function mergeGridData($, newData) {
        const $grid = $('#grid_busca');
        const currentData = $grid.jqGrid('getGridParam', 'data');

        const currentMap = new Map();
        currentData.forEach(row => currentMap.set(row.id, row));

        const newMap = new Map();
        newData.forEach(row => newMap.set(row.id, row));

        let updated = 0, added = 0, removed = 0;

        newData.forEach(newRow => {
            const current = currentMap.get(newRow.id);
            if (current && JSON.stringify(current) !== JSON.stringify(newRow)) {
                Object.assign(current, newRow);
                $grid.jqGrid('setRowData', newRow.id, newRow);
                updated++;
            }
        });

        newData.forEach(newRow => {
            if (!currentMap.has(newRow.id)) {
                currentData.push(newRow);
                added++;
            }
        });

        const idsToRemove = [];
        currentData.forEach(row => {
            if (!newMap.has(row.id)) idsToRemove.push(row.id);
        });
        idsToRemove.forEach(id => {
            const idx = currentData.findIndex(r => r.id === id);
            if (idx >= 0) {
                currentData.splice(idx, 1);
                removed++;
            }
        });

        if (updated + added + removed > 0) {
            $grid.jqGrid('setGridParam', {data: currentData}).trigger('reloadGrid');
            $('#sp_1_grid_busca_pager').text(currentData.length);
        }
    }

    function showStatusBar($) {
        if ($('#sigss-status-bar').length) return;

        const freqText = getFreqText();
        const $statusBar = $(`
            <div id="sigss-status-bar">
                <span class="sigss-pulse-small"></span>
                <span class="sigss-status-text" id="sigss-status-text">Inicializando...</span>
                <span style="color:#999;font-size:10px;" id="sigss-freq-indicator">⏱ ${freqText}</span>
                <button class="sigss-status-btn" id="sigss-pause-btn" title="Pausar">⏸</button>
                <button class="sigss-status-btn" id="sigss-freq-btn" title="Configurar">⚙</button>
                <button class="sigss-status-btn" id="sigss-close-btn" title="Fechar">✖</button>
            </div>
        `);

        $('#gbox_grid_busca').after($statusBar);

        $('#sigss-pause-btn').click((e) => {
            e.preventDefault();
            isPaused = !isPaused;
            $('#sigss-pause-btn').text(isPaused ? '▶' : '⏸');
            $('#sigss-pause-btn').attr('title', isPaused ? 'Retomar' : 'Pausar');
            $('#sigss-status-bar').toggleClass('paused', isPaused);
            $('.sigss-pulse-small').toggleClass('paused', isPaused);
            updateStatusBar();
        });

        $('#sigss-freq-btn').click((e) => {
            e.preventDefault();
            $('#sigss-freq-modal').show();
        });

        $('#sigss-close-btn').click((e) => {
            e.preventDefault();
            stopAutoRefresh(true);
            restoreGrid($);
        });

        updateStatusBar();
    }

    function updateStatusBar(customMsg) {
        const $text = $('#sigss-status-text');
        if (!$text.length) return;

        if (customMsg) {
            $text.text(customMsg);
            return;
        }

        if (isPaused) {
            $text.html('<strong>Pausado</strong>');
            return;
        }

        if (!lastUpdate) {
            $text.text('Aguardando...');
            return;
        }

        const elapsed = Math.floor((new Date() - lastUpdate) / 1000);
        $text.html(`Última atualização: <strong>${elapsed}s</strong> atrás`);
    }

    function updateFreqIndicator() {
        const $indicator = $('#sigss-freq-indicator');
        if ($indicator.length) {
            $indicator.text('⏱ ' + getFreqText());
        }
    }

    function getFreqText() {
        const sec = Math.floor(refreshInterval / 1000);
        if (sec < 60) return `${sec}s`;
        const min = Math.floor(sec / 60);
        const rest = sec % 60;
        return rest > 0 ? `${min}m${rest}s` : `${min}min`;
    }

    function fetchWithOriginalUrl($, url, prof, apcn) {
        return new Promise((ok, fail) => {
            let p = $.extend(true, {}, savedBaseParams);

            const set = (k, v) => {
                let found = false;
                for (let key in p) {
                    if (typeof p[key] === 'string' && p[key].startsWith(k + ':')) {
                        p[key] = k + ':' + v;
                        found = true;
                    }
                }
                if (!found) {
                    let i = 0;
                    while (p['filters[' + i + ']']) i++;
                    p['filters[' + i + ']'] = k + ':' + v;
                }
            };

            set('prsaIdp', prof.idp);
            set('prsaIds', prof.ids);
            if (apcn) set('apcnId', apcn);

            p.rows = 1000;
            p.page = 1;

            $.ajax({ url, type: 'GET', data: p, dataType: 'json', headers: {"Accept": "application/json"}, success: ok, error: fail });
        });
    }

    // ★ SOLUÇÃO 1: restoreGrid melhorado
    function restoreGrid($) {
        const $g = $('#grid_busca');

        // Para completamente qualquer operação em andamento
        stopAutoRefresh(true);

        // Limpa dados locais primeiro
        if ($g.jqGrid('getGridParam','datatype') === 'local') {
            $g.jqGrid('clearGridData', true);
        }

        // Restaura configuração original com postData resolvido
        $g.jqGrid('setGridParam', {
            datatype: originalGridConfig.datatype || 'json',
            url: originalGridConfig.url,
            postData: $.extend(true, {}, originalGridConfig.postData),
            data: [],
            rowNum: 15
        });

        // Força reset do estado interno
        isMultiViewActive = false;
        savedBaseParams = null;
        currentTargets = [];
        lastUpdate = null;
        isPaused = false;

        log('✅ Grid restaurado ao estado original');
    }

    function patchGrid($g) { const h=$g.jqGrid('getGridParam','afterInsertRow'); if(h&&!h.isPatched){ const n=function(){try{return h.apply(this,arguments);}catch(e){}}; n.isPatched=true; $g.jqGrid('setGridParam',{afterInsertRow:n}); } }

    function resolveGridParams($,g){ 
        const r={}; 
        const raw=g.jqGrid('getGridParam','postData'); 
        $.each(raw,(k,v)=>{
            try{
                r[k]=typeof v==='function'?v():v;
            }catch(e){
                r[k]='';
            }
        }); 
        return r; 
    }

    function get(p,k){ let r=''; Object.keys(p).forEach(key=>{if(String(p[key]).startsWith(k+':'))r=String(p[key]).split(':')[1];}); return r; }
    function getCurrentDate(){ const d=new Date(); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
    function showUI(s,t){ $('#sigss-loader').remove(); if(s) $('body').append(`<div id="sigss-loader" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;justify-content:center;align-items:center;flex-direction:column;color:white;"><h2>Carregando...</h2><div id="sigss-msg">...</div></div>`); }
    function updateUI(c,n){ $('#sigss-msg').text(`${c} - ${n}`); }

})();

// ==UserScript==
// @name         SIGSS - Visualizar Todas as Agendas V24 (Layout Fix)
// @namespace    http://tampermonkey.net/
// @version      24.0
// @description  Correção de layout no Odonto (botões empilhados 100% width)
// @author       Renato Krebs Rosa
// @match        *://*.cloudmv.com.br/sigss/atendimentoConsultaAgenda*
// @match        *://*.cloudmv.com.br/sigss/atendimentoOdontoAgenda*
// @updateURL    https://raw.githubusercontent.com/RenatoKR/UserScripts/main/SIGSS-Visualizar-Todas-as-Agendas.user.js
// @downloadURL  https://raw.githubusercontent.com/RenatoKR/UserScripts/main/SIGSS-Visualizar-Todas-as-Agendas.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'sigss_saved_doctors';
    let originalGridConfig = { datatype: 'json', url: '', postData: {} };

    const CONTEXT = {
        isOdonto: window.location.href.includes('atendimentoOdontoAgenda'),
        profSelectIds: [
            '#agco\\.profissionalDestino\\.prsaPK',
            '#agod\\.profissionalDestino\\.prsaPK',
            'select[name*="profissionalDestino"]'
        ]
    };

    const STYLES = `
        /* Estilo Padrão (Consulta - Horizontal) */
        .sigss-toolbar-universal {
            display: inline-flex; gap: 5px; align-items: center; margin-left: 5px; vertical-align: middle;
        }

        /* Botões Base */
        .btn-sigss-compact {
            padding: 0 12px; border: 1px solid transparent; border-radius: 4px;
            cursor: pointer; font-size: 11px; font-weight: bold; color: white;
            display: inline-flex; align-items: center; justify-content: center; gap: 4px;
            transition: background 0.2s; text-transform: uppercase; font-family: sans-serif;
            height: 30px; box-sizing: border-box;
        }

        /* --- CORREÇÃO PARA ODONTO (Vertical e Largura Total) --- */
        .sigss-toolbar-odonto {
            display: flex !important;
            flex-direction: column !important; /* Empilha verticalmente */
            width: 100% !important;            /* Ocupa toda a largura do fieldset */
            margin-left: 0 !important;         /* Remove margem esquerda que empurrava */
            gap: 4px !important;               /* Espaço entre botões */
            margin-top: 5px;
        }

        .btn-sigss-odonto {
            width: 100% !important;            /* Botão ocupa 100% da linha */
            height: 28px !important;
            font-size: 11px !important;
            margin: 0 !important;              /* Remove margens externas */
        }
        /* ------------------------------------------------------- */

        .btn-quick { background-color: #4CAF50; border-color: #388E3C; } .btn-quick:hover { background-color: #43A047; }
        .btn-config { background-color: #2196F3; border-color: #1976D2; } .btn-config:hover { background-color: #1E88E5; }

        /* Modal */
        #sigss-selector-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9998; display: none; justify-content: center; align-items: center; }
        #sigss-selector-content { background: white; width: 500px; max-height: 80vh; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); display: flex; flex-direction: column; font-family: sans-serif; }
        .sigss-header { padding: 15px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; background: #f5f5f5; border-radius: 8px 8px 0 0; }
        .sigss-body { padding: 10px; overflow-y: auto; flex: 1; }
        .sigss-item { display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #eee; cursor: pointer; font-size: 13px; }
        .sigss-item:hover { background: #e3f2fd; }
        .sigss-item input { margin-right: 10px; cursor: pointer; }
        .sigss-footer { padding: 15px; border-top: 1px solid #ddd; display: flex; justify-content: flex-end; gap: 10px; background: #fff; border-radius: 0 0 8px 8px; }
        .btn-modal { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .btn-cancel { background: #e0e0e0; color: #333; } .btn-confirm { background: #2196F3; color: white; }
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
        originalGridConfig.postData = $.extend(true, {}, $grid.jqGrid('getGridParam', 'postData'));
        injectUI($); createModalHTML($);
        const $profSelect = getProfSelect($);
        if ($profSelect.length) $profSelect.on('change', () => { restoreGrid($); updateBadge($); });
        $('#botao_pesquisar, button[onclick*="pesquisar"]').on('click', () => restoreGrid($));
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

        // Define classe base dependendo do contexto
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
        const $ = window.jQuery; const $grid = $('#grid_busca');
        try {
            let u = $grid.jqGrid('getGridParam','url');
            if(!originalGridConfig.url && u) { originalGridConfig.url=u; originalGridConfig.postData=$.extend(true,{},$grid.jqGrid('getGridParam','postData')); }
            if(!originalGridConfig.url) return alert('Erro URL grid.');

            patchGrid($grid);
            const raw = resolveGridParams($, $grid);
            const base = { unsaIdp:get(raw,'unsaIdp')||'1001', unsaIds:get(raw,'unsaIds')||'1', limoIdp:get(raw,'limoIdp')||'5', limoIds:get(raw,'limoIds')||'1', data:get(raw,'agcoData')||getCurrentDate() };

            showUI(true, targets.length);
            $grid.jqGrid('setGridParam',{datatype:'local',data:[]}).trigger('reloadGrid');
            let allRows = []; const colModel = $grid.jqGrid('getGridParam','colModel');

            for (let i = 0; i < targets.length; i++) {
                const prof = targets[i]; updateUI(i+1, prof.nome);
                try {
                    let apcnId = '';
                    try { const r = await $.post('atividadeProfissionalCnes/buscaPorUnsaPrsaPadrao', {'unsaPK.idp':base.unsaIdp,'unsaPK.ids':base.unsaIds,'prsaPK.idp':prof.idp,'prsaPK.ids':prof.ids}); if(Array.isArray(r)&&r.length)apcnId=r[0][0];else if(r?.apcnId)apcnId=r.apcnId; }catch(e){}
                    const res = await fetchWithOriginalUrl($, originalGridConfig.url, raw, prof, apcnId);
                    if (res && res.rows) {
                        const mapped = res.rows.map(r => {
                            const obj = { id: r.id + '-' + prof.idp };
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
                } catch (e) { console.error(e); }
            }
            showUI(false);
            $grid.jqGrid('setGridParam',{datatype:'local',data:allRows,rowNum:5000}).trigger('reloadGrid');
            $('#sp_1_grid_busca_pager').text(allRows.length);
            setTimeout(() => { window.dispatchEvent(new Event('scroll')); }, 500);
        } catch (e) { showUI(false); alert('Erro: ' + e.message); restoreGrid($); }
    }

    function fetchWithOriginalUrl($, url, cur, prof, apcn) {
        return new Promise((ok, fail) => {
            let p = $.extend(true, {}, cur);
            const set = (k, v) => {
                let f = false;
                for(let key in p) if(typeof p[key]==='string' && p[key].startsWith(k+':')) { p[key]=k+':'+v; f=true; }
                if(!f) { let i=0; while(p['filters['+i+']'])i++; p['filters['+i+']']=k+':'+v; }
            };
            set('prsaIdp', prof.idp); set('prsaIds', prof.ids); if(apcn) set('apcnId', apcn);
            p.rows=1000; p.page=1;
            $.ajax({ url:url, type:'GET', data:p, dataType:'json', headers:{"Accept":"application/json"}, success:ok, error:fail });
        });
    }

    function restoreGrid($) { const $g=$('#grid_busca'); if($g.jqGrid('getGridParam','datatype')==='local'){ $g.jqGrid('setGridParam',{datatype:originalGridConfig.datatype||'json',url:originalGridConfig.url,data:[]}); } }
    function patchGrid($g) { const h=$g.jqGrid('getGridParam','afterInsertRow'); if(h&&!h.isPatched){ const n=function(){try{return h.apply(this,arguments);}catch(e){}}; n.isPatched=true; $g.jqGrid('setGridParam',{afterInsertRow:n}); } }
    function resolveGridParams($,g){ const r={}; const raw=g.jqGrid('getGridParam','postData'); $.each(raw,(k,v)=>{try{r[k]=typeof v==='function'?v():v;}catch(e){r[k]='';}}); return r; }
    function get(p,k){ let r=''; Object.keys(p).forEach(key=>{if(String(p[key]).startsWith(k+':'))r=String(p[key]).split(':')[1];}); return r; }
    function getCurrentDate(){ const d=new Date(); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }
    function showUI(s,t){ $('#sigss-loader').remove(); if(s) $('body').append(`<div id="sigss-loader" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;justify-content:center;align-items:center;flex-direction:column;color:white;"><h2>Carregando...</h2><div id="sigss-msg">...</div></div>`); }
    function updateUI(c,n){ $('#sigss-msg').text(`${c} - ${n}`); }

})();

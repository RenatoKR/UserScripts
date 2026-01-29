// ==UserScript==
// @name         SIGSS - Título Dinâmico
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Define o título da página baseado no conteúdo do elemento sigss-title
// @match        *://*/sigss/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ShadyBS/UserScripts/main/SIGSS-Titulo-Dinâmico.user.js
// @downloadURL  https://raw.githubusercontent.com/ShadyBS/UserScripts/main/SIGSS-Titulo-Dinâmico.user.js
// @supportURL   https://github.com/ShadyBS/UserScripts/issues
// ==/UserScript==

(function() {
    'use strict';
    
    // Aguarda o elemento carregar
    const observer = new MutationObserver(function() {
        const titleElement = document.querySelector('.ui-widget-header.sigss-title');
        if (titleElement && titleElement.textContent.trim()) {
            document.title = titleElement.textContent.trim();
            observer.disconnect();
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Tenta imediatamente também
    const titleElement = document.querySelector('.ui-widget-header.sigss-title');
    if (titleElement) {
        document.title = titleElement.textContent.trim();
    }
})();

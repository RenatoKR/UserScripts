# 🚀 UserScripts para SIGSS

Coleção de scripts de usuário para melhorar a experiência de uso do sistema SIGSS (Sistema Integrado de Gestão de Saúde e Serviços).

## 📋 Scripts Disponíveis

### 1. SIGSS - Título Dinâmico
Define o título da aba do navegador baseado no conteúdo da página atual do SIGSS, facilitando a identificação quando você tem várias abas abertas.

**[📥 Instalar SIGSS - Título Dinâmico](https://raw.githubusercontent.com/RenatoKR/UserScripts/main/SIGSS-Titulo-Dinâmico.user.js)**

---

### 2. SIGSS - Visualizar Todas as Agendas
Permite visualizar múltiplas agendas de profissionais simultaneamente, com atualização automática em tempo real. Ideal para coordenadores e gestores que precisam monitorar várias agendas.

**Recursos:**
- Visualização simultânea de múltiplas agendas
- Atualização automática configurável
- Salvamento de agendas favoritas
- Controle de pausa/retomada

**[📥 Instalar SIGSS - Visualizar Todas as Agendas](https://raw.githubusercontent.com/RenatoKR/UserScripts/main/SIGSS-Visualizar-Todas-as-Agendas.user.js)**

---

### 3. SIGSS - Diferenciador AG/DI
Identifica visualmente se um agendamento é do tipo AG (Agendado) ou DI (Demanda Imediata), adicionando badges coloridas nas listagens.

**Recursos:**
- Badge visual AG (verde) ou DI (laranja)
- Configuração de palavras-chave personalizadas
- Processamento paralelo para desempenho otimizado

**[📥 Instalar SIGSS - Diferenciador AG/DI](https://raw.githubusercontent.com/RenatoKR/UserScripts/main/sigss-diferenciador-ag-di.user.js)**

---

## 🔧 Como Instalar

### Passo 1: Instalar o Tampermonkey

O Tampermonkey é uma extensão de navegador que permite executar scripts personalizados em páginas web.

**Escolha seu navegador:**

- **Google Chrome / Microsoft Edge / Brave / Opera**  
  [🔗 Instalar Tampermonkey na Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)

- **Mozilla Firefox**  
  [🔗 Instalar Tampermonkey no Firefox Add-ons](https://addons.mozilla.org/pt-BR/firefox/addon/tampermonkey/)

- **Safari**  
  [🔗 Instalar Tampermonkey na App Store](https://apps.apple.com/br/app/tampermonkey/id1482490089)

**Após a instalação**, você verá o ícone do Tampermonkey na barra de ferramentas do seu navegador.

---

### Passo 2: Instalar os Scripts

Depois de instalar o Tampermonkey, basta clicar nos links de instalação dos scripts acima. O Tampermonkey irá abrir automaticamente e pedir confirmação para instalar o script.

**Processo de instalação:**

1. Clique no link **"📥 Instalar [Nome do Script]"** do script desejado
2. Uma nova aba será aberta mostrando o código do script
3. O Tampermonkey detectará automaticamente e mostrará a tela de instalação
4. Clique no botão **"Instalar"** ou **"Install"**
5. Pronto! O script está instalado e funcionando

---

### Passo 3: Verificar Instalação

Para confirmar que os scripts estão instalados corretamente:

1. Clique no ícone do **Tampermonkey** na barra de ferramentas
2. Selecione **"Painel de Controle"** ou **"Dashboard"**
3. Você verá a lista de todos os scripts instalados
4. Certifique-se de que os scripts estão **habilitados** (com o botão verde ligado)

---

## ⚙️ Gerenciamento de Scripts

### Habilitar/Desabilitar um Script

1. Clique no ícone do **Tampermonkey**
2. Você verá a lista de scripts ativos na página atual
3. Clique no botão de alternância ao lado do nome do script para habilitar/desabilitar

### Atualizar Scripts

Os scripts são configurados para atualização automática. Porém, você pode forçar uma atualização manual:

1. Abra o **Painel de Controle** do Tampermonkey
2. Na coluna **"Última atualização"**, clique no ícone de atualização ao lado do script
3. O script será atualizado para a versão mais recente

### Desinstalar um Script

1. Abra o **Painel de Controle** do Tampermonkey
2. Encontre o script que deseja remover
3. Clique no ícone da **lixeira** (🗑️) na linha do script
4. Confirme a desinstalação

---

## 🐛 Problemas Comuns

### O script não está funcionando

1. **Verifique se o Tampermonkey está ativo**: O ícone deve estar colorido na barra de ferramentas
2. **Certifique-se de que o script está habilitado**: Acesse o Painel de Controle e verifique
3. **Recarregue a página**: Pressione `Ctrl + F5` (Windows) ou `Cmd + Shift + R` (Mac)
4. **Verifique se está na URL correta**: Os scripts só funcionam em páginas do SIGSS (`*/sigss/*`)

### O script instalou mas não aparece nada

Alguns scripts só são ativados em páginas específicas do SIGSS. Verifique a descrição de cada script para saber onde ele deve funcionar.

### Como reportar um problema

Se você encontrou um bug ou tem uma sugestão:

1. Acesse a [página de Issues](https://github.com/RenatoKR/UserScripts/issues)
2. Clique em **"New Issue"**
3. Descreva o problema ou sugestão detalhadamente
4. Inclua informações sobre navegador, versão do script e prints se possível

---

## 📝 Notas Importantes

- ⚠️ **Estes scripts são ferramentas não oficiais** e não têm vínculo com os desenvolvedores do SIGSS
- 🔒 **Os scripts funcionam apenas no seu navegador** e não modificam dados no servidor
- ✅ **Compatibilidade**: Testados no Chrome, Firefox e Edge
- 🔄 **Atualizações automáticas**: Os scripts verificam atualizações diariamente

---

## 👨‍💻 Desenvolvimento

Estes scripts foram desenvolvidos para facilitar o trabalho diário com o sistema SIGSS, automatizando tarefas repetitivas e melhorando a visualização de informações.

**Autor**: Renato Krebs Rosa

---

## 📄 Licença

Estes scripts são disponibilizados como estão, sem garantias. Use por sua conta e risco.

---

## 🤝 Contribuições

Contribuições, sugestões e melhorias são bem-vindas! Sinta-se à vontade para:

- Abrir Issues para reportar problemas
- Sugerir novos recursos
- Enviar Pull Requests com melhorias

---

## 📚 Recursos Adicionais

- [Documentação do Tampermonkey](https://www.tampermonkey.net/documentation.php)
- [Como criar UserScripts](https://www.tampermonkey.net/documentation.php?ext=dhdg#Q100)
- [Suporte do Tampermonkey](https://www.tampermonkey.net/faq.php)

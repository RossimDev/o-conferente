# O CONFERENTE

**Assistente inteligente de conferência de produtos e documentos.**
Importe PDFs e fotografias uma única vez — o sistema extrai códigos, nomes, descrições, quantidades e a **localização exata** de cada item (página, tabela, linha, coluna e coordenadas), organiza tudo em um banco de dados próprio e encontra qualquer item em segundos.

> 🎯 **Missão:** reduzir o tempo de conferência, evitar erros humanos, preservar informações e facilitar a localização de qualquer item.

---

## 1. Funcionalidades

| Área | Recursos |
|---|---|
| **Importação** | PDF (texto ou escaneado), JPG, PNG, WebP, TIFF, HEIC, fotografia direta pela câmera |
| **Extração** | Texto direto do PDF (PDF.js) quando há camada de texto; OCR (Tesseract) para imagens e PDFs escaneados; reconhecimento de tabelas (cabeçalho, linhas, colunas) |
| **Pesquisa** | Resultado **exato** por código isolado dos demais; prefixo (`2000` → 20001, 20002, 20003); código parcial; códigos semelhantes (grupo separado); nome, descrição e referência (índice FTS5, ignora acentos). Zeros à esquerda (`00742`) e códigos alfanuméricos (`AB-1001`) sempre preservados |
| **Localização exata** | Cada registro guarda documento, nº da importação, página, tabela, linha, coluna, coordenadas e o trecho original. Um clique abre o documento na página certa com **destaque visual** da região |
| **Documentos originais** | Preservados byte a byte; download, visualização, data, nº de importação e vínculo permanente com os registros |
| **Conferência** | Status por item (pendente/conferido/divergente/revisar), sessões independentes (Estoque, Recebimento, Separação…), progresso por sessão e **modo contínuo** (pesquisa → marca → próximo) |
| **Rastreabilidade** | O mesmo código em vários documentos mantém todas as ocorrências; histórico completo de alterações (antes/depois, data, hora, tipo) |
| **Gerenciamento** | Editar, excluir, arquivar, restaurar, favoritar, filtrar; lixeira com retenção configurável; exclusão de documento com 2 modos (com registros ou só o arquivo) |
| **Exportação** | Excel (.xlsx) e CSV; backup completo (.zip com banco + arquivos) e restauração |
| **Offline (PWA)** | Instalável em Android, iOS e desktop; app shell em cache; marcações de conferência offline são sincronizadas quando a conexão volta |
| **Segurança** | Autenticação por usuário/senha (bcrypt), tokens com expiração, múltiplos perfis (admin/usuário) |

## 2. Arquitetura e tecnologias

```
o-conferente/
├── server/                  # Backend Node.js (Express)
│   ├── src/
│   │   ├── index.js         # Servidor, API e entrega do PWA
│   │   ├── db.js            # SQLite + FTS5 (esquema, triggers de índice)
│   │   ├── auth.js          # Autenticação (bcrypt + tokens)
│   │   ├── routes/          # auth, documents, records, search, conference, misc
│   │   └── services/
│   │       ├── pdfio.js     # Extração de texto e rasterização de PDF (pdf.js + canvas)
│   │       ├── ocr.js       # OCR em português/inglês (Tesseract, offline)
│   │       ├── parser.js    # Interpretação de tabelas → registros localizados
│   │       ├── extract.js   # Pipeline de processamento + fila em segundo plano
│   │       └── files.js     # Armazenamento preservado dos originais
│   ├── storage/documents/   # Arquivos originais (intocados pelo processamento)
│   ├── data/                # Banco SQLite (conferente.db)
│   └── tessdata/            # Dados do OCR (por+eng) — 100% offline
├── client/                  # Frontend React + Vite (PWA instalável)
│   └── src/pages/           # Início, Busca, Detalhes, Importação, Revisão,
│                            # Banco de dados, Documentos, Conferência,
│                            # Histórico, Ajustes, Lixeira
├── tools/                   # make-test-docs, run-tests, seed, smoke-extract
└── tests/docs/              # Documentos de teste reais (PDFs + imagem)
```

- **Banco:** SQLite (WAL) com índice FTS5 — rápido, zero manutenção, arquivo único.
- **OCR:** Tesseract.js com idiomas `por+eng` — processado no servidor, sem serviços externos.
- **PDF:** pdf.js (texto com coordenadas + renderização de páginas com destaque).
- **Servidor:** Node 20+, Express. **Frontend:** React 18, React Router, PWA (Workbox).

## 3. Instalação

**Requisitos:** Node.js 20 ou superior e npm.

```bash
# 1. Instale as dependências
cd o-conferente
npm install
cd client && npm install && npm run build && cd ..

# 2. Baixe os dados do OCR (português + inglês, ~21 MB, uma única vez)
npm run download:ocr

# 3. Inicie o servidor (produção)
npm start
# → http://localhost:3001
```

Na primeira abertura, o aplicativo pede a **criação do administrador**. Pronto.

**Dados de demonstração (opcional):**
```bash
node tools/make-test-docs.js   # gera PDFs/imagens de exemplo
node tools/seed.js             # importa tudo (cria admin/admin123 se não houver usuários)
```

**Desenvolvimento (com hot-reload):**
```bash
npm start                      # API + app em :3001
cd client && npm run dev       # ou Vite em :5173 com proxy /api
```

### Variáveis de ambiente (opcionais)

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta do servidor |
| `OC_DB_PATH` | `server/data/conferente.db` | Caminho do banco |
| `OC_STORAGE_DIR` | `server/storage` | Armazenamento de arquivos |
| `OC_OCR_LANG` | `por+eng` | Idiomas do OCR |

## 4. Publicação

### Opção A — Servidor próprio / VPS (recomendada)

```bash
# com PM2 (reinício automático)
npm install -g pm2
pm2 start server/src/index.js --name o-conferente
pm2 save && pm2 startup
```

Aponte um domínio com HTTPS (Caddy/Nginx fazem o proxy reverso para a porta 3001).
O PWA e o Service Worker **exigem HTTPS** em produção (instalação e offline).

Exemplo de configuração Caddy:
```
conferente.suaempresa.com {
    reverse_proxy localhost:3001
}
```

### Opção B — Docker (qualquer nuvem)

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN npm install && cd client && npm install && npm run build
EXPOSE 3001
CMD ["node", "server/src/index.js"]
```

### Instalação em celulares e computadores

Com o app publicado (HTTPS), abra o endereço no navegador:
- **Android/Chrome:** menu → “Instalar aplicativo”.
- **iOS/Safari:** Compartilhar → “Adicionar à Tela de Início”.
- **Windows/Edge/Chrome:** ícone de instalação na barra de endereço.

Funciona também sem instalar, direto no navegador.

## 5. Utilização rápida

1. **Importar:** tela *Importar* → arraste PDFs/imagens ou use a câmera. O processamento roda em segundo plano; ao final, revise os dados (linhas com baixa confiança ficam destacadas em amarelo) e confirme.
2. **Pesquisar:** digite `20001` (exato), `2000` (prefixo), um nome ou referência. O resultado exato aparece primeiro, sempre separado.
3. **Localizar:** clique no item → *Abrir no documento na página X* → o documento original abre na página com a região destacada.
4. **Conferir:** tela *Conferir* → crie uma sessão (ex.: “Conferência 01 — Estoque”) → use o **modo contínuo**: digite o código, confira, toque em *Conferido* e avance. O progresso de cada sessão é independente.
5. **Gerenciar:** *Documentos* (abrir, baixar, renomear, arquivar, reprocessar, excluir) e *Banco de dados* (editar, filtrar, favoritar, exportar Excel/CSV).
6. **Proteger:** *Ajustes* → backup .zip completo (banco + arquivos originais) e restauração.

### Comportamento da pesquisa numérica (exemplo do projeto)

Com os registros `20001, 20002, 20003, 20010`:
- `20001` → **exato** primeiro (sem confundir com 20002/20003); semelhantes vão para grupo próprio.
- `2000` → todos os códigos que **começam com 2000** (20001, 20002, 20003).
- Códigos nunca são tratados como números: `00742` ≠ `742`, zeros e formatos alfanuméricos preservados.

## 6. Testes

A suíte executa os 14 testes obrigatórios contra um servidor real, com banco isolado e documentos autênticos:

```bash
node tools/make-test-docs.js   # gera os documentos de teste
node tools/run-tests.js        # executa a suíte completa
```

Última execução: **19/19 aprovados** (14 obrigatórios + 5 complementares) — inclui importação de PDF com produtos, fotografia com OCR, PDF escaneado, pesquisa exata/prefixo/nome, abertura do documento na página com destaque, linha/coluna, persistência de conferência, edição/exclusão/limpeza, códigos repetidos em documentos diferentes, exclusão de documento nos 2 modos, exportação e backup/restauração.

## 7. Serviços externos e custos

| Item | Custo |
|---|---|
| OCR (Tesseract.js) | **Gratuito** — roda localmente no servidor |
| Extração/renderização de PDF (pdf.js) | **Gratuito** |
| Banco de dados (SQLite) | **Gratuito** — sem servidor de banco |
| Hospedagem | Qualquer VPS/nuvem (a partir de ~R$ 20/mês) ou infraestrutura própria |
| APIs externas / API Keys | **Nenhuma** — nenhuma credencial é necessária |

Não há dependência de serviços pagos. Tudo é processado no próprio servidor.

## 8. Estrutura dos dados (por registro)

`código, nome, descrição, referência, quantidade, unidade, categoria, campos adicionais (JSON), documento original, nº da importação, página, tabela, linha, coluna, coordenadas (x, y, largura, altura), tamanho da página, trecho original, confiança, status de conferência, datas, favorito, arquivo.`

Nenhuma informação é inventada: campos não identificados no documento permanecem vazios e são sinalizados para revisão quando a confiança da leitura é baixa.

## 9. Compatibilidade

- ✅ Celulares Android (Chrome/instalável como PWA)
- ✅ Celulares iOS (Safari/Adicionar à Tela de Início)
- ✅ Computadores Windows, macOS e Linux (navegadores modernos)
- ✅ Diferentes tamanhos de tela (layout responsivo, otimizado para uso com uma mão)
- ✅ Uso offline do app shell + fila de sincronização de marcações

## 10. Publicação na Vercel (nuvem)

- **URL de produção:** `https://o-conferente-rossimdevs-projects.vercel.app` (projeto `o-conferente`)
- **Contas independentes:** a tela de entrada permite **Entrar** em uma conta existente ou **Criar nova conta**. Cada conta mantém seus próprios documentos, registros, conferências e histórico. A primeira conta criada em um ambiente novo torna-se administradora.
- **Publicação automática:** cada `git push` na branch `main` do repositório dispara o build e atualiza o site.
- **Banco de dados:** o app roda com seu banco SQLite próprio, sem serviços externos. Na nuvem, os dados permanecem ativos durante o uso; além disso, **uma cópia da conta e de tudo o que é feito é salva automaticamente neste dispositivo** — na próxima visita, o app restaura a conta e os dados sozinho e você apenas entra com sua senha (sem criar conta de novo).
- **Backup extra:** use **Ajustes → Backup** para baixar um `.zip` com dados + originais (guarde em local seguro ou transfira para outro dispositivo via **Restaurar**).
- **Limites da nuvem:** uploads de até 200 MB; processamento de OCR pode levar alguns segundos por página.
- **Credenciais iniciais:** `admin` / `admin123` (troque em Ajustes após o primeiro acesso).

---

**O Conferente** — importe uma vez, encontre em segundos.

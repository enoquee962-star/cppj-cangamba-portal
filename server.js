const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');

const app = express();

// --- 1. CONFIGURAÇÕES INICIAIS ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'cppj-cangamba-secret-key',
    resave: false,
    saveUninitialized: true
}));

// Configuração do Multer (Armazenamento em memória para gerar fotos em Base64)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Caminhos dos ficheiros de dados
const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
    jovens: path.join(DATA_DIR, 'jovens.json'),
    utilizadores: path.join(DATA_DIR, 'utilizadores.json'),
    financas: path.join(DATA_DIR, 'financas.json'),
    logs: path.join(DATA_DIR, 'logs.json'),
    noticias: path.join(DATA_DIR, 'noticias.json')
};

// Garantir que a pasta data existe
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Funções Auxiliares para Manipulação de JSON
const carregarDados = (caminho) => {
    try {
        if (!fs.existsSync(caminho)) return [];
        return JSON.parse(fs.readFileSync(caminho, 'utf-8'));
    } catch (e) { return []; }
};

const salvarDados = (caminho, dados) => {
    fs.writeFileSync(caminho, JSON.stringify(dados, null, 2));
};

const registarLog = (usuario, acao, detalhe) => {
    let logs = carregarDados(FILES.logs);
    logs.unshift({ usuario, acao, detalhe, data: new Date().toLocaleString('pt-PT') });
    salvarDados(FILES.logs, logs.slice(0, 500));
};

// --- 2. MIDDLEWARES DE ACESSO ---
const verificarLogin = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

const permitirGestao = (req, res, next) => {
    if (req.session.user && (req.session.user.tipo === 'coordenador' || req.session.user.tipo === 'tesoureiro')) return next();
    res.status(403).send("Acesso negado: Apenas para coordenação/tesouraria.");
};

// --- 3. ROTAS PÚBLICAS E CONSULTA ---
app.get('/', (req, res) => {
    res.render('index', { noticias: carregarDados(FILES.noticias) });
});

app.post('/consultar-registo', (req, res) => {
    const { bi } = req.body;
    const j = carregarDados(FILES.jovens).find(m => m.bi === bi);
    if (j) return res.render('ficha_membro', { jovens: [j], user: { tipo: 'publico' } });
    res.send("<script>alert('Membro não encontrado em Cangamba!'); window.history.back();</script>");
});

// --- 4. AUTENTICAÇÃO E LOGIN ---
app.get('/login', (req, res) => res.render('login'));

app.post('/auth', (req, res) => {
    const { usuario, senha } = req.body;
    const users = carregarDados(FILES.utilizadores);
    const user = users.find(u => u.usuario === usuario && u.senha === senha);

    if (user) {
        req.session.user = user;
        registarLog(user.nome, "LOGIN", "Entrou no sistema");
        return res.redirect(user.tipo === 'registador' ? '/meus-registos' : '/admin-dashboard');
    }
    res.send("<script>alert('Utilizador ou Senha incorretos!'); window.history.back();</script>");
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. GESTÃO DE MEMBROS ---
app.get('/cadastro', verificarLogin, (req, res) => res.render('cadastro_passos'));

app.post('/finalizar-cadastro', verificarLogin, (req, res) => {
    let j = carregarDados(FILES.jovens);
    const novo = { 
        ...req.body, 
        id: Date.now(), 
        dataRegistro: new Date().toLocaleDateString('pt-PT'), 
        registadoPor: req.session.user.nome 
    };
    j.push(novo);
    salvarDados(FILES.jovens, j);
    registarLog(req.session.user.nome, "CADASTRO", `Registou ${novo.nome}`);
    res.redirect('/admin-lista');
});

app.get('/admin-lista', verificarLogin, (req, res) => {
    res.render('lista_membros', { jovens: carregarDados(FILES.jovens), user: req.session.user });
});

app.get('/eliminar/:id', permitirGestao, (req, res) => {
    let j = carregarDados(FILES.jovens).filter(m => m.id !== parseInt(req.params.id));
    salvarDados(FILES.jovens, j);
    res.redirect('/admin-lista');
});

// --- 6. FINANÇAS E TESOURARIA ---
app.get('/relatorio-financeiro', permitirGestao, (req, res) => {
    const financas = carregarDados(FILES.financas);
    const entradas = financas.filter(f => f.categoria === 'Entrada').reduce((s, f) => s + parseFloat(f.valor), 0);
    const saidas = financas.filter(f => f.categoria === 'Saída').reduce((s, f) => s + parseFloat(f.valor), 0);
    res.render('relatorio_financeiro', { 
        financas, 
        totalEntradas: entradas, 
        totalSaidas: saidas, 
        saldoFinal: entradas - saidas, 
        user: req.session.user 
    });
});

app.post('/adicionar-financa', permitirGestao, (req, res) => {
    let f = carregarDados(FILES.financas);
    const nova = { ...req.body, id: Date.now(), data: new Date().toLocaleDateString('pt-PT'), resp: req.session.user.nome };
    f.unshift(nova);
    salvarDados(FILES.financas, f);
    registarLog(req.session.user.nome, "FINANÇAS", `Lançou ${req.body.categoria} de ${req.body.valor} Kz`);
    res.redirect('/relatorio-financeiro');
});

// --- 7. EMISSÃO DE PASSE ---
app.post('/gerar-passe', verificarLogin, upload.single('foto'), (req, res) => {
    const { termo } = req.body;
    const j = carregarDados(FILES.jovens).find(m => m.bi === termo || m.telefone === termo);
    if (!j) return res.send("<script>alert('Membro não encontrado!'); window.history.back();</script>");
    
    let fotoBase64 = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    res.render('passe_membro', { j, fotoEnviada: fotoBase64 });
});

// --- 8. AUDITORIA E WEBHOOKS ---
app.get('/historico-auditoria', permitirGestao, (req, res) => {
    res.render('auditoria', { logs: carregarDados(FILES.logs) });
});

app.post('/webhook-github', (req, res) => {
    exec('git pull origin main', (err, stdout) => {
        if (err) return res.status(500).send("Erro no sincronismo");
        console.log("Servidor atualizado via GitHub");
        res.status(200).send("OK");
    });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
    ---------------------------------------------------
    🚀 PORTAL CPPJ CANGAMBA ATIVO
    📡 URL: http://localhost:${PORT}
    📂 AMBIENTE: ${process.env.NODE_ENV || 'Desenvolvimento'}
    ---------------------------------------------------
    `);
});

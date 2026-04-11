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
    secret: 'cppj-cangamba-secret',
    resave: false,
    saveUninitialized: true
}));

// Configuração do Multer (Memória para gerar o Passe em Base64)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Caminhos dos ficheiros de dados
const FILES = {
    jovens: path.join(__dirname, 'data', 'jovens.json'),
    utilizadores: path.join(__dirname, 'data', 'utilizadores.json'),
    financas: path.join(__dirname, 'data', 'financas.json'),
    logs: path.join(__dirname, 'data', 'logs.json'),
    noticias: path.join(__dirname, 'data', 'noticias.json'),
    sugestoes: path.join(__dirname, 'data', 'sugestoes.json')
};

// Funções Auxiliares de Dados
const carregarDados = (caminho) => {
    try {
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

// --- 2. MIDDLEWARES DE SEGURANÇA ---
const verificarLogin = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

const permitirGestao = (req, res, next) => {
    if (req.session.user && (req.session.user.tipo === 'coordenador' || req.session.user.tipo === 'tesoureiro')) return next();
    res.status(403).send("Acesso negado.");
};

// --- 3. ROTAS PÚBLICAS E CONSULTA ---
app.get('/', (req, res) => {
    res.render('index', { noticias: carregarDados(FILES.noticias) });
});

app.post('/consultar-registo', (req, res) => {
    const { bi } = req.body;
    const j = carregarDados(FILES.jovens).find(m => m.bi === bi);
    if (j) return res.render('ficha_membro', { jovens: [j], user: { tipo: 'publico' } });
    res.send("<script>alert('Membro não encontrado!'); window.history.back();</script>");
});

// --- 4. AUTENTICAÇÃO ---
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
    res.send("<script>alert('Credenciais Inválidas'); window.history.back();</script>");
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. GESTÃO DE MEMBROS (CRUD) ---
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

// --- 6. TESOURARIA E RELATÓRIOS ---
app.post('/adicionar-financa', permitirGestao, (req, res) => {
    let f = carregarDados(FILES.financas);
    const nova = { ...req.body, id: Date.now(), data: new Date().toLocaleDateString('pt-PT'), resp: req.session.user.nome };
    f.unshift(nova);
    salvarDados(FILES.financas, f);
    res.redirect('/relatorio-financeiro');
});

app.get('/relatorio-financeiro', permitirGestao, (req, res) => {
    const financas = carregarDados(FILES.financas);
    const entradas = financas.filter(f => f.categoria === 'Entrada').reduce((s, f) => s + parseFloat(f.valor), 0);
    const saidas = financas.filter(f => f.categoria === 'Saída').reduce((s, f) => s + parseFloat(f.valor), 0);
    res.render('relatorio_financeiro', { financas, totalEntradas: entradas, totalSaidas: saidas, saldoFinal: entradas - saidas, user: req.session.user });
});

// --- 7. EMISSÃO DE PASSE (FRENTE/VERSO) ---
app.post('/gerar-passe', verificarLogin, upload.single('foto'), (req, res) => {
    const { termo } = req.body;
    const j = carregarDados(FILES.jovens).find(m => m.bi === termo || m.telefone === termo);
    if (!j) return res.send("<script>alert('Membro não encontrado!'); window.history.back();</script>");
    
    let fotoBase64 = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    res.render('passe_membro', { j, fotoEnviada: fotoBase64 });
});

// --- 8. WEBHOOK GITHUB (Railway Sync) ---
app.post('/webhook-github', (req, res) => {
    exec('git pull origin main', (err, stdout) => {
        if (err) return res.status(500).send(err);
        res.status(200).send('Sincronizado!');
    });
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Portal CPPJ Ativo na porta ${PORT}`));

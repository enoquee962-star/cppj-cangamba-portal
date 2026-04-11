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
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'cppj-cangamba-secret-2026',
    resave: false,
    saveUninitialized: true
}));

// Configuração do Multer para processar fotos em memória (Base64)
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

// Criar pasta data se não existir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Funções Auxiliares
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

// --- 2. MIDDLEWARES DE PROTEÇÃO ---
const verificarLogin = (req, res, next) => {
    if (req.session.user) return next();
    res.redirect('/login');
};

const permitirGestao = (req, res, next) => {
    if (req.session.user && (req.session.user.tipo === 'coordenador' || req.session.user.tipo === 'tesoureiro')) return next();
    res.status(403).render('erro', { mensagem: "Acesso negado: Nível insuficiente." });
};

// --- 3. PORTAL PÚBLICO E CONSULTA ---
app.get('/', (req, res) => {
    res.render('index', { noticias: carregarDados(FILES.noticias) });
});

app.post('/consultar-registo', (req, res) => {
    const { bi } = req.body;
    const j = carregarDados(FILES.jovens).find(m => m.bi === bi);
    if (j) return res.render('ficha_membro', { jovens: [j], user: { tipo: 'publico' } });
    res.send("<script>alert('Membro não encontrado em Cangamba!'); window.history.back();</script>");
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
    res.send("<script>alert('Utilizador ou Senha inválidos!'); window.history.back();</script>");
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. GESTÃO DE MEMBROS E ADMIN ---
app.get('/admin-dashboard', verificarLogin, (req, res) => {
    const jovens = carregarDados(FILES.jovens);
    const financas = carregarDados(FILES.financas);
    res.render('dashboard', { total: jovens.length, financas: financas.slice(0, 5), user: req.session.user });
});

app.get('/admin-lista', verificarLogin, (req, res) => {
    res.render('lista_membros', { jovens: carregarDados(FILES.jovens), user: req.session.user });
});

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

// --- 6. FINANCEIRO E TESOURARIA ---
app.get('/relatorio-financeiro', permitirGestao, (req, res) => {
    const f = carregarDados(FILES.financas);
    const entradas = f.filter(x => x.categoria === 'Entrada').reduce((s, x) => s + parseFloat(x.valor), 0);
    const saidas = f.filter(x => x.categoria === 'Saída').reduce((s, x) => s + parseFloat(x.valor), 0);
    res.render('relatorio_financeiro', { 
        financas: f, totalEntradas: entradas, totalSaidas: saidas, saldoFinal: entradas - saidas, user: req.session.user 
    });
});

app.post('/adicionar-financa', permitirGestao, (req, res) => {
    let f = carregarDados(FILES.financas);
    const mov = { ...req.body, id: Date.now(), data: new Date().toLocaleDateString('pt-PT'), resp: req.session.user.nome };
    f.unshift(mov);
    salvarDados(FILES.financas, f);
    registarLog(req.session.user.nome, "FINANÇAS", `Lançamento de ${req.body.valor} Kz`);
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

// --- 8. AUDITORIA E WEBHOOKS (GITHUB) ---
app.get('/historico-auditoria', permitirGestao, (req, res) => {
    res.render('auditoria', { logs: carregarDados(FILES.logs) });
});

app.post('/webhook-github', (req, res) => {
    exec('git pull origin main', (err, stdout) => {
        if (err) return res.status(500).send("Erro no sincronismo");
        console.log("♻️ Servidor atualizado via GitHub Push");
        res.status(200).send("Atualizado");
    });
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 CPPJ Cangamba Online: Porta ${PORT}`);
});

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- 1. CAMINHOS DOS FICHEIROS (Baseado na tua foto) ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const getPath = (file) => path.join(DATA_DIR, file);

const FILES = {
    jovens: getPath('jovens.json'),
    users: getPath('usuarios.json'),
    noticias: getPath('noticias.json'),
    sugestoes: getPath('sugestoes.json'),
    logs: getPath('auditoria.json'),
    financas: getPath('financas.json')
};

// --- 2. FUNÇÕES DE PERSISTÊNCIA ---
const carregarDados = (arquivo) => {
    if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, JSON.stringify([]));
    try {
        return JSON.parse(fs.readFileSync(arquivo, 'utf-8') || "[]");
    } catch (e) { return []; }
};

const salvarDados = (arquivo, dados) => {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
};

// --- 3. CONFIGURAÇÕES DO EXPRESS ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    secret: 'cppj-cangamba-secret-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// --- 4. MIDDLEWARES ---
const verificarLogin = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    next();
};

const permitirGestao = (req, res, next) => {
    const autorizados = ['coordenador', 'assessor', 'tesoureiro'];
    if (req.session.user && autorizados.includes(req.session.user.tipo)) return next();
    res.redirect('/meus-registos');
};

const registarLog = (usuario, acao, detalhe) => {
    let logs = carregarDados(FILES.logs);
    logs.unshift({ id: Date.now(), usuario, acao, detalhe, data: new Date().toLocaleString('pt-PT') });
    salvarDados(FILES.logs, logs.slice(0, 100));
};

// --- 5. ROTAS PRINCIPAIS ---
app.get('/', (req, res) => {
    res.render('index', { 
        noticias: carregarDados(FILES.noticias),
        sugestoes: carregarDados(FILES.sugestoes)
    });
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    const users = carregarDados(FILES.users);
    const user = users.find(u => u.usuario === usuario && u.senha === senha);
    if (user) {
        req.session.user = user;
        return res.redirect(user.tipo === 'registador' ? '/meus-registos' : '/admin-dashboard');
    }
    res.send("<script>alert('Dados inválidos!'); window.location='/login';</script>");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- 6. GESTÃO DE MEMBROS ---
app.get('/admin-dashboard', permitirGestao, (req, res) => {
    const jovens = carregarDados(FILES.jovens);
    const financas = carregarDados(FILES.financas);
    const stats = {
        crismados: jovens.filter(j => j.crismado === 'Sim').length,
        naoCrismados: jovens.filter(j => j.crismado === 'Não').length,
        masculino: jovens.filter(j => j.genero === 'Masculino').length,
        feminino: jovens.filter(j => j.genero === 'Feminino').length
    };
    res.render('admin_dashboard', { user: req.session.user, stats, devedores_lista: [], financas_lista: financas });
});

app.get('/admin-lista', permitirGestao, (req, res) => {
    res.render('admin_lista', { jovens: carregarDados(FILES.jovens), user: req.session.user });
});

app.get('/cadastro', verificarLogin, (req, res) => res.render('cadastro_passos'));

app.post('/finalizar-cadastro', verificarLogin, (req, res) => {
    let j = carregarDados(FILES.jovens);
    const novo = { ...req.body, id: Date.now(), dataRegistro: new Date().toLocaleDateString('pt-PT'), registadoPor: req.session.user.nome };
    j.push(novo); salvarDados(FILES.jovens, j);
    registarLog(req.session.user.nome, "CADASTRO", `Registou ${novo.nome}`);
    res.redirect('/admin-lista');
});

// --- 7. TESOURARIA ---
app.post('/adicionar-financa', permitirGestao, (req, res) => {
    let f = carregarDados(FILES.financas);
    const nova = { id: Date.now(), ...req.body, data: new Date().toLocaleDateString('pt-PT'), resp: req.session.user.nome };
    f.unshift(nova); salvarDados(FILES.financas, f);
    const msg = `*RECIBO CPPJ*\nRecebemos *${nova.valor} Kz* de *${nova.jovem}*.`;
    res.send(`<script>window.open('https://wa.me{nova.telefone}?text=${encodeURIComponent(msg)}', '_blank'); window.location='/admin-dashboard';</script>`);
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`?? CPPJ Cangamba Online (JSON Mode) na porta ${PORT}`));
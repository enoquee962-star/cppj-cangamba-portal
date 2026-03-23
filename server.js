const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- 1. CONFIGURAÇÕES E PASTAS ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const getPath = (file) => path.join(DATA_DIR, file);

const FILES = {
    jovens: getPath('jovens.json'),
    users: getPath('usuarios.json'),
    noticias: getPath('noticias.json'),
    logs: getPath('auditoria.json'),
    financas: getPath('financas.json')
};

// --- 2. PERSISTÊNCIA DE DADOS ---
const carregarDados = (arquivo) => {
    if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, JSON.stringify([]));
    try {
        const conteudo = fs.readFileSync(arquivo, 'utf-8');
        return JSON.parse(conteudo || "[]");
    } catch (e) { return []; }
};

const salvarDados = (arquivo, dados) => {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
};

// Inicializar utilizador Admin padrão se não existir
const inicializarAdmin = () => {
    let users = carregarDados(FILES.users);
    if (users.length === 0) {
        users.push({ usuario: 'admin', senha: '123', nome: 'Coordenador Geral', tipo: 'coordenador' });
        salvarDados(FILES.users, users);
    }
};
inicializarAdmin();

// --- 3. MIDDLEWARES ---
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

// --- 4. ROTAS PÚBLICAS ---
app.get('/', (req, res) => {
    res.render('index', { 
        noticias: carregarDados(FILES.noticias)
    });
});

app.post('/consultar-registo', (req, res) => {
    const { bi } = req.body;
    const jovens = carregarDados(FILES.jovens);
    const encontrou = jovens.find(j => j.bi === bi || (j.nome && j.nome.toUpperCase().includes(bi.toUpperCase())));

    if (encontrou) {
        res.send(`<script>alert('REGISTO ATIVO!\\nNome: ${encontrou.nome}\\nCentro: ${encontrou.centro_pastoral}'); window.location='/';</script>`);
    } else {
        res.send(`<script>alert('Não encontramos registo para: ${bi}'); window.location='/';</script>`);
    }
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    const users = carregarDados(FILES.users);
    const user = users.find(u => u.usuario === usuario && u.senha === senha);
    if (user) {
        req.session.user = user;
        registarLog(user.nome, "LOGIN", "Entrou no sistema");
        return res.redirect(user.tipo === 'registador' ? '/meus-registos' : '/admin-dashboard');
    }
    res.send("<script>alert('Dados inválidos!'); window.location='/login';</script>");
});

app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/'); 
});

// --- 5. DASHBOARD E LISTAS ---
app.get('/admin-dashboard', permitirGestao, (req, res) => {
    const jovens = carregarDados(FILES.jovens);
    const stats = {
        crismados: jovens.filter(j => j.crismado === 'Sim').length,
        naoCrismados: jovens.filter(j => j.crismado === 'Não').length,
        masculino: jovens.filter(j => j.genero === 'Masculino').length,
        feminino: jovens.filter(j => j.genero === 'Feminino').length
    };
    res.render('admin_dashboard', { user: req.session.user, stats, devedores_lista: [], financas_lista: carregarDados(FILES.financas) });
});

app.get('/admin-lista', permitirGestao, (req, res) => {
    res.render('admin_lista', { jovens: carregarDados(FILES.jovens), user: req.session.user });
});

app.get('/meus-registos', verificarLogin, (req, res) => {
    const todos = carregarDados(FILES.jovens);
    const meus = todos.filter(j => j.registadoPor === req.session.user.nome);
    res.render('meus_registos', { jovens: meus, user: req.session.user });
});

// --- 6. CADASTRO E EDIÇÃO ---
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
    res.redirect(req.session.user.tipo === 'registador' ? '/meus-registos' : '/admin-lista');
});

app.get('/editar/:id', verificarLogin, (req, res) => {
    const jovens = carregarDados(FILES.jovens);
    const j = jovens.find(item => item.id === parseInt(req.params.id));
    res.render('editar_jovem', { j });
});

app.post('/atualizar-jovem/:id', verificarLogin, (req, res) => {
    let jovens = carregarDados(FILES.jovens);
    const id = parseInt(req.params.id);
    const index = jovens.findIndex(j => j.id === id);
    if (index !== -1) {
        jovens[index] = { ...jovens[index], ...req.body, id: id };
        salvarDados(FILES.jovens, jovens);
        res.redirect('/admin-lista');
    }
});

// --- 7. EMISSÃO DE PASSES E FICHAS ---
app.post('/gerar-passe', verificarLogin, upload.single('foto'), (req, res) => {
    const { termo } = req.body;
    const jovens = carregarDados(FILES.jovens);
    const j = jovens.find(item => item.bi === termo || item.telefone === termo);
    if (!j) return res.send("<script>alert('Membro não encontrado!'); window.history.back();</script>");

    let fotoBase64 = null;
    if (req.file) {
        fotoBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    }
    res.render('passe_membro', { j, fotoEnviada: fotoBase64 });
});

app.get('/ficha/:id', verificarLogin, (req, res) => {
    const jovens = carregarDados(FILES.jovens);
    const j = jovens.filter(item => item.id === parseInt(req.params.id));
    res.render('ficha_membro', { jovens: j });
});

// --- 8. SEGURANÇA E AUDITORIA ---
app.get('/historico-auditoria', permitirGestao, (req, res) => {
    res.render('auditoria', { logs: carregarDados(FILES.logs) });
});

app.get('/gestao-acessos', permitirGestao, (req, res) => {
    res.render('gestao_acessos', { usuarios: carregarDados(FILES.users) });
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 CPPJ Cangamba Online rodando na porta ${PORT}`);
    console.log(`👤 Login Padrão: admin / Senha: 123`);
});

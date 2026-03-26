const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- 1. CONFIGURAÇÕES DE PASTAS E FICHEIROS ---
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

// --- 2. FUNÇÕES DE APOIO (JSON) ---
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

// Criar Admin inicial se a base de dados estiver vazia
const inicializarAdmin = () => {
    let users = carregarDados(FILES.users);
    if (users.length === 0) {
        users.push({ usuario: 'admin', senha: '123', nome: 'Coordenador Geral', tipo: 'coordenador' });
        salvarDados(FILES.users, users);
    }
};
inicializarAdmin();

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

// --- 4. MIDDLEWARES DE SEGURANÇA ---
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

// --- 5. ROTAS PÚBLICAS (INDEX & CONSULTA) ---
app.get('/', (req, res) => {
    res.render('index', { noticias: carregarDados(FILES.noticias) });
});

app.post('/consultar-registo', (req, res) => {
    const { bi } = req.body;
    const jovens = carregarDados(FILES.jovens);
    const encontrou = jovens.find(j => 
        (j.bi && j.bi === bi) || 
        (j.nome && j.nome.toUpperCase().includes(bi.toUpperCase()))
    );

    if (encontrou) {
        res.send(`<script>alert('REGISTO ENCONTRADO!\\nNome: ${encontrou.nome}\\nCentro: ${encontrou.centro_pastoral}'); window.location='/';</script>`);
    } else {
        res.send(`<script>alert('Registo não encontrado para: ${bi}'); window.location='/';</script>`);
    }
});

// --- 6. AUTENTICAÇÃO ---
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

// --- 7. DASHBOARDS E LISTAGENS ---
app.get('/admin-dashboard', permitirGestao, (req, res) => {
    const jovens = carregarDados(FILES.jovens);
    const stats = {
        crismados: jovens.filter(j => j.crismado === 'Sim').length,
        naoCrismados: jovens.filter(j => j.crismado === 'Não').length,
        masculino: jovens.filter(j => j.genero === 'Masculino').length,
        feminino: jovens.filter(j => j.genero === 'Feminino').length
    };
    res.render('admin_dashboard', { 
        user: req.session.user, 
        stats, 
        devedores_lista: [], 
        financas_lista: carregarDados(FILES.financas) 
    });
});

app.get('/admin-lista', permitirGestao, (req, res) => {
    res.render('admin_lista', { jovens: carregarDados(FILES.jovens), user: req.session.user });
});

app.get('/meus-registos', verificarLogin, (req, res) => {
    const todos = carregarDados(FILES.jovens);
    const meus = todos.filter(j => j.registadoPor === req.session.user.nome);
    res.render('meus_registos', { jovens: meus, user: req.session.user });
});

// --- 8. GESTÃO DE ACESSOS (UTILIZADORES) ---
app.get('/gestao-acessos', permitirGestao, (req, res) => {
    res.render('gestao_acessos', { usuarios: carregarDados(FILES.users), user: req.session.user });
});

app.get('/acessos', permitirGestao, (req, res) => res.redirect('/gestao-acessos'));

app.post('/criar-acesso', permitirGestao, (req, res) => {
    let users = carregarDados(FILES.users);
    if (users.find(u => u.usuario === req.body.usuario)) {
        return res.send("<script>alert('Utilizador já existe!'); window.history.back();</script>");
    }
    users.push(req.body);
    salvarDados(FILES.users, users);
    registarLog(req.session.user.nome, "SEGURANÇA", `Criou acesso para ${req.body.nome}`);
    res.redirect('/gestao-acessos');
});

app.get('/eliminar-acesso/:usuario', permitirGestao, (req, res) => {
    let users = carregarDados(FILES.users);
    const alvo = req.params.usuario;
    if (alvo === 'admin' || alvo === req.session.user.usuario) {
        return res.send("<script>alert('Ação proibida por segurança!'); window.location='/gestao-acessos';</script>");
    }
    salvarDados(FILES.users, users.filter(u => u.usuario !== alvo));
    registarLog(req.session.user.nome, "SEGURANÇA", `Eliminou acesso de ${alvo}`);
    res.redirect('/gestao-acessos');
});

// --- 9. OPERAÇÕES DE MEMBROS (CADASTRO/PASSE/FICHA) ---
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

app.post('/gerar-passe', verificarLogin, upload.single('foto'), (req, res) => {
    const { termo } = req.body;
    const j = carregarDados(FILES.jovens).find(item => item.bi === termo || item.telefone === termo);
    if (!j) return res.send("<script>alert('Membro não encontrado!'); window.history.back();</script>");

    let fotoBase64 = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    res.render('passe_membro', { j, fotoEnviada: fotoBase64 });
});

app.get('/ficha/:id', verificarLogin, (req, res) => {
    const j = carregarDados(FILES.jovens).filter(item => item.id === parseInt(req.params.id));
    res.render('ficha_membro', { jovens: j });
});

app.get('/eliminar/:id', permitirGestao, (req, res) => {
    let jovens = carregarDados(FILES.jovens);
    salvarDados(FILES.jovens, jovens.filter(j => j.id !== parseInt(req.params.id)));
    res.redirect('/admin-lista');
});

// --- 10. AUDITORIA ---
app.get('/historico-auditoria', permitirGestao, (req, res) => {
    res.render('auditoria', { logs: carregarDados(FILES.logs) });
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor CPPJ Ativo na porta ${PORT}`));

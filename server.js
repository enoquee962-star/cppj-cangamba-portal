const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- 1. CONFIGURAÇÃO DE CAMINHOS (Pasta: data) ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const getPath = (file) => path.join(DATA_DIR, file);

// --- 2. FUNÇÕES DE PERSISTÊNCIA ---
const carregarDados = (arquivo) => {
    const p = getPath(arquivo);
    if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify([]));
    try {
        const conteudo = fs.readFileSync(p, 'utf-8');
        return JSON.parse(conteudo || "[]");
    } catch (e) { return []; }
};

const salvarDados = (arquivo, dados) => {
    fs.writeFileSync(getPath(arquivo), JSON.stringify(dados, null, 2));
};

// --- 3. CONFIGURAÇÕES DO SERVIDOR ---
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

const apenasCoordenador = (req, res, next) => {
    if (req.session.user && req.session.user.tipo === 'coordenador') return next();
    res.send("<script>alert('Acesso Negado!'); window.location='/admin-dashboard';</script>");
};

// --- 5. PORTAL PÚBLICO E CONSULTA (RESOLUÇÃO DO TEU ERRO) ---
app.get('/', (req, res) => {
    res.render('index', { 
        noticias: carregarDados('noticias.json'),
        sugestoes: carregarDados('sugestoes.json')
    });
});

app.post('/consultar', (req, res) => {
    const termo = (req.body.termo || "").toLowerCase().trim();
    const jovens = carregarDados('jovens.json');
    
    // Procura por Nome ou BI (Exatamente como o BI que escreveste na foto)
    const encontrado = jovens.find(j => {
        const nome = j.nome ? j.nome.toLowerCase() : "";
        const bi = j.bi ? j.bi.toLowerCase() : "";
        return nome.includes(termo) || bi === termo;
    });

    if (encontrado) {
        res.render('ficha_membro', { 
            jovens: [encontrado], 
            user: req.session.user || null 
        });
    } else {
        res.send("<script>alert('Membro não encontrado em Cangamba! Verifica o BI ou Nome.'); window.location='/';</script>");
    }
});

app.post('/enviar-sugestao', (req, res) => {
    let s = carregarDados('sugestoes.json');
    s.unshift({ id: Date.now(), ...req.body, data: new Date().toLocaleString('pt-PT') });
    salvarDados('sugestoes.json', s);
    res.send("<script>alert('Obrigado pela sugestão!'); window.location='/';</script>");
});

// --- 6. LOGIN E ACESSOS ---
app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
    const { usuario, senha } = req.body;
    const users = carregarDados('usuarios.json');
    const user = users.find(u => u.usuario === usuario && u.senha === senha);
    
    if (user) {
        req.session.user = user;
        return res.redirect(user.tipo === 'registador' ? '/meus-registos' : '/admin-dashboard');
    }
    res.send("<script>alert('Credenciais inválidas!'); window.location='/login';</script>");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- 7. DASHBOARDS ---
app.get('/admin-dashboard', permitirGestao, (req, res) => {
    const jovens = carregarDados('jovens.json');
    const financas = carregarDados('financas.json');
    const stats = {
        crismados: jovens.filter(j => j.crismado === 'Sim').length,
        naoCrismados: jovens.filter(j => j.crismado === 'Não').length,
        masculino: jovens.filter(j => j.genero === 'Masculino').length,
        feminino: jovens.filter(j => j.genero === 'Feminino').length
    };
    res.render('admin_dashboard', { user: req.session.user, stats, devedores_lista: [], financas_lista: financas });
});

app.get('/admin-lista', permitirGestao, (req, res) => {
    res.render('admin_lista', { jovens: carregarDados('jovens.json'), user: req.session.user });
});

app.get('/meus-registos', verificarLogin, (req, res) => {
    const todos = carregarDados('jovens.json');
    const meus = todos.filter(j => j.registadoPor === req.session.user.nome);
    res.render('meus_registos', { user: req.session.user, jovens: meus });
});

// --- 8. GESTÃO DE MEMBROS (CRUD) ---
app.get('/cadastro', verificarLogin, (req, res) => res.render('cadastro_passos'));

app.post('/finalizar-cadastro', verificarLogin, (req, res) => {
    let j = carregarDados('jovens.json');
    const novo = { ...req.body, id: Date.now(), dataRegistro: new Date().toLocaleDateString('pt-PT'), registadoPor: req.session.user.nome };
    j.push(novo); 
    salvarDados('jovens.json', j);
    res.redirect(req.session.user.tipo === 'registador' ? '/meus-registos' : '/admin-lista');
});

app.get('/editar/:id', permitirGestao, (req, res) => {
    const j = carregarDados('jovens.json').find(i => i.id == req.params.id);
    res.render('editar_membro', { j, user: req.session.user });
});

app.post('/atualizar-jovem/:id', permitirGestao, (req, res) => {
    let j = carregarDados('jovens.json');
    const index = j.findIndex(i => i.id == req.params.id);
    if (index !== -1) { j[index] = { ...j[index], ...req.body }; salvarDados('jovens.json', j); }
    res.redirect('/admin-lista');
});

app.get('/eliminar/:id', apenasCoordenador, (req, res) => {
    let j = carregarDados('jovens.json');
    salvarDados('jovens.json', j.filter(i => i.id != req.params.id));
    res.redirect('/admin-lista');
});

// --- 9. TESOURARIA E PASSES ---
app.post('/adicionar-financa', permitirGestao, (req, res) => {
    let f = carregarDados('financas.json');
    const nova = { id: Date.now(), ...req.body, data: new Date().toLocaleDateString('pt-PT'), resp: req.session.user.nome };
    f.unshift(nova); 
    salvarDados('financas.json', f);
    const msg = `*RECIBO CPPJ*\nRecebemos *${nova.valor} Kz* de *${nova.jovem}*.`;
    res.send(`<script>window.open('https://wa.me{nova.telefone}?text=${encodeURIComponent(msg)}', '_blank'); window.location='/admin-dashboard';</script>`);
});

app.post('/gerar-passe', verificarLogin, upload.single('foto'), (req, res) => {
    const j = carregarDados('jovens.json').find(i => i.bi === req.body.termo || i.id == req.body.termo);
    const foto = req.file ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}` : null;
    if (j) res.render('passe_membro', { j, fotoEnviada: foto });
    else res.send("<script>alert('Membro não encontrado!'); window.history.back();</script>");
});

// --- 10. GESTÃO DE ACESSOS E AUDITORIA ---
app.get('/acessos', apenasCoordenador, (req, res) => {
    res.render('acessos', { usuarios: carregarDados('usuarios.json') });
});

app.post('/criar-acesso', apenasCoordenador, (req, res) => {
    let u = carregarDados('usuarios.json'); 
    u.push({ id: Date.now(), ...req.body }); 
    salvarDados('usuarios.json', u);
    res.redirect('/acessos');
});

app.get('/historico-auditoria', apenasCoordenador, (req, res) => {
    res.render('historico_auditoria', { logs: carregarDados('auditoria.json'), user: req.session.user });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 CPPJ Cangamba Online na porta ${PORT}`));

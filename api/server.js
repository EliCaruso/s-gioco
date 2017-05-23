'use strict';
const pkg    = require('./package.json');
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const mysql  = require('mysql');
const settings = require('./settings.json');
const datasource = settings.datasource;
const jwtConfig = settings.jwt;
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = new express();
const startDate = new Date();

const poolConfig = Object.assign(datasource, {
    connectionLimit : 10
});

const pool = mysql.createPool(poolConfig);

app.use(cookieParser());
app.use(bodyParser.json());

function paginationMiddleware(req, res, next){
    let limit;
    try {
        limit = Number(req.query.limit) || 10;
    } catch(err) {
        limit = 10;
    }

    if (limit > 100) limit = 100;

    let skip;
    try {
        skip = Number(req.query.skip) || 0;
    } catch(err) {
        skip = 0;
    }

    req.limit = limit;
    req.skip = skip;
    next();
}

function authenticationMiddleware(req, res, next) {
    jwt.verify(req.cookies.auth, jwtConfig.secret, (err, decoded) => {
        if(!err) {
            req.user = decoded.data;
        }
        next();
    })
}

app.get('/', (req, res)=> {
    res.json({
        name: pkg.name,
        version: pkg.version,
        startDate,
        uptime: new Date() - startDate
    });
});

exposeCrud('tags');

exposeCrud('articles');

exposeList('articles_tags_th');

app.post('/login', (req, res) => {
    const username = req.body.username;
    const password = req.body.password;
    if(!username || !password) return req.status(400);

    pool.query('SELECT username,permissions FROM users WHERE username=? and password=?', [username, sha256(password)], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if(!results) return res.status(404).send();

        const token = jwt.sign({
            exp: Math.floor(Date.now() / 1000) + (60 * 60),
            data: results[0]
        }, jwtConfig.secret);

        res.cookie("auth", token).send();
    });
});

app.all('*', (req, res) => {
    res.status(404).json( {
        status: 404,
        message: 'Pagina non trovata'
    });
});

app.listen(8000, () => {
    console.log('Server in ascolto sulla porta 8000')
});

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest();
}

function formatResponse(req, data) {
    const limit = req.limit;
    const skip = req.skip;
    return {
        count: data.length,
        skip,
        limit,
        prevSkip: skip - limit < 0? 0 : skip - limit,
        nextSkip: skip + limit,
        data
    };
}

function exposeList(tableName) {
    app.get(`/${tableName}`, paginationMiddleware, (req, res) => {
        pool.query(`SELECT * FROM ${tableName} LIMIT ${req.limit} OFFSET ${req.skip}`, (err, results) => {
            if (err) return res.status(500).json({ error: err });
            res.json(formatResponse(req, results));
        });
    });
}

function hasPermission(permissionRequired, permissions) {
    permissions = JSON.parse(permissions);
    for (let i = 0; i < permissions.length; i++) {
        let perm = permissions[i];
        if(perm === "*" || perm === permissionRequired) return true;
        //Do something
    }
    return false;
}

function exposeCrud(tableName) {
    exposeList(tableName);

    app.get(`/${tableName}/:alias`, (req, res) => {
        pool.query(`SELECT * FROM ${tableName} WHERE alias=?`, req.params.alias, (error, results) => {
            if (err) return res.status(500).json({ error });
            if(!results.length) return res.status(404).json({
                "message": "Not found!"
            });
            res.json(results[0]);
        });
    });

    app.post(`/${tableName}`, authenticationMiddleware, (req, res) => {
        if(!req.user) return res.status(401).send();
        if(!hasPermission("article.create", req.user.permissions)) return res.status(403).send();
        console.log(req.body);
        pool.query(`INSERT INTO ${tableName} SET ?`, req.body, (error, results) => {
            if (error) return res.status(500).json({ error });
            res.json(results);
        });
    });

    app.put(`/${tableName}/:alias`, authenticationMiddleware, (req, res) => {
        if(!req.user) return res.status(401).send();
        if(!hasPermission("article.update", req.user.permissions)) return res.status(403).send();

        pool.query(`UPDATE ${tableName} SET ? WHERE alias=?`, [req.body, req.params.alias], (error, results)  => {
            if (error) return res.status(500).json({ error });
            res.json(results);
        });
    });

    app.delete(`/${tableName}/:alias`, authenticationMiddleware, (req, res) => {
        if(!req.user) return res.status(401).send();
        if(!hasPermission("article.delete", req.user.permissions)) return res.status(403).send();

        pool.query(`DELETE FROM ${tableName} WHERE alias=?`, [req.body, req.params.alias], (error, results) => {
            if (error) return res.status(500).json({ error });
            res.json(results);
        });
    });
}

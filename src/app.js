var express = require('express');
var app = express();
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

app.use(cookieParser());
var path = require('path');
app.set('view engine', 'pug');
var authRoute = require('./api/auth/authorization').router;
app.use('/auth', authRoute);
var mainApplication = require('./services/application');
app.use('/application', mainApplication);
app.use('/', function(req, res, next) {
    if (req.cookies && 'auth_token' in req.cookies) {
        res.redirect('/application');
    }
    else {
        res.redirect('/auth');
    }
});



module.exports = app;
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
require('./routes')(app);

app.use(function (req, res) {
    res.status(404).json({ message: 'Route not found', data: null });
});

app.use(function (err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err.status) return res.status(err.status).json({ message: err.message, data: err.data });
    if (err.name === 'ValidationError' || err.name === 'CastError' || err.code === 11000) {
        return res.status(400).json({ message: 'Invalid request', data: null });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error', data: null });
});

async function start() {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set. Copy .env.example to .env and add your MongoDB Atlas connection string.');
        process.exitCode = 1;
        return;
    }
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        app.listen(port, function () { console.log('Server running on port ' + port); });
    } catch (_) {
        console.error('Could not connect to MongoDB. Check MONGODB_URI and Atlas network access.');
        process.exitCode = 1;
    }
}

if (require.main === module) start();

module.exports = app;

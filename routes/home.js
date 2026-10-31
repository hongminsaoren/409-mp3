const express = require('express');
const router = express.Router();

router.get('/', function (req, res) {
    res.json({ message: 'Task API is running', data: {} });
});

module.exports = router;

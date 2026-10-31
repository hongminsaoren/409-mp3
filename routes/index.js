module.exports = function (app) {
    app.use('/api/users', require('./users'));
    app.use('/api/tasks', require('./tasks'));
    app.use('/api', require('./home'));
};

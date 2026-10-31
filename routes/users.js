const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError, response, parseJson, collectionQuery, validId, cleanString, asyncRoute } = require('./helpers');

const router = express.Router();

function userInput(body) {
    const name = cleanString(body.name);
    const email = cleanString(body.email);
    if (!name || !email) throw new ApiError(400, 'Invalid user', 'A non-empty name and email are required.');
    if (body.pendingTasks !== undefined && !Array.isArray(body.pendingTasks)) {
        throw new ApiError(400, 'Invalid user', 'pendingTasks must be an array.');
    }
    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (pendingTasks.some((id) => typeof id !== 'string' || !validId(id))) {
        throw new ApiError(400, 'Invalid user', 'Every pending task must have a valid id.');
    }
    return { name, email, pendingTasks: [...new Set(pendingTasks)] };
}

async function validateUserReferences(input, currentId, session) {
    const duplicate = await User.findOne({ email: input.email, ...(currentId ? { _id: { $ne: currentId } } : {}) }).session(session);
    if (duplicate) throw new ApiError(400, 'Email already in use', 'Another user already uses this email.');
    const tasks = await Task.find({ _id: { $in: input.pendingTasks } }).session(session);
    if (tasks.length !== input.pendingTasks.length) throw new ApiError(404, 'Task not found', 'One or more pending tasks do not exist.');
    if (tasks.some((task) => task.completed)) throw new ApiError(400, 'Invalid pending task', 'Completed tasks cannot be pending.');
    return tasks;
}

async function assignTasksToUser(user, tasks, session) {
    for (const task of tasks) {
        if (task.assignedUser && task.assignedUser !== String(user._id)) {
            await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: String(task._id) } }, { session });
        }
        task.assignedUser = String(user._id);
        task.assignedUserName = user.name;
        await task.save({ session });
    }
}

router.get('/', asyncRoute(async (req, res) => {
    const data = await collectionQuery(User, req.query, undefined);
    return response(res, 200, 'OK', data);
}));

router.post('/', asyncRoute(async (req, res) => {
    const input = userInput(req.body);
    const session = await mongoose.startSession();
    let created;
    try {
        await session.withTransaction(async () => {
            const tasks = await validateUserReferences(input, null, session);
            [created] = await User.create([input], { session });
            await assignTasksToUser(created, tasks, session);
        });
    } finally { await session.endSession(); }
    return response(res, 201, 'User created', created);
}));

router.get('/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) throw new ApiError(404, 'User not found');
    const select = parseJson(req.query.select, 'select');
    let query = User.findById(req.params.id);
    if (select) query = query.select(select);
    const user = await query;
    if (!user) throw new ApiError(404, 'User not found');
    return response(res, 200, 'OK', user);
}));

router.put('/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id) || !(await User.exists({ _id: req.params.id }))) throw new ApiError(404, 'User not found');
    const input = userInput(req.body);
    const session = await mongoose.startSession();
    let updated;
    try {
        await session.withTransaction(async () => {
            const user = await User.findById(req.params.id).session(session);
            if (!user) throw new ApiError(404, 'User not found');
            const tasks = await validateUserReferences(input, user._id, session);
            const newIds = new Set(input.pendingTasks);
            const removed = user.pendingTasks.filter((id) => !newIds.has(id));
            if (removed.length) {
                await Task.updateMany(
                    { _id: { $in: removed }, assignedUser: String(user._id) },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
                    { session }
                );
            }
            user.name = input.name;
            user.email = input.email;
            user.pendingTasks = input.pendingTasks;
            await assignTasksToUser(user, tasks, session);
            await Task.updateMany({ assignedUser: String(user._id) }, { $set: { assignedUserName: user.name } }, { session });
            updated = await user.save({ session });
        });
    } finally { await session.endSession(); }
    return response(res, 200, 'User updated', updated);
}));

router.delete('/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id) || !(await User.exists({ _id: req.params.id }))) throw new ApiError(404, 'User not found');
    const session = await mongoose.startSession();
    let deleted;
    try {
        await session.withTransaction(async () => {
            deleted = await User.findByIdAndDelete(req.params.id, { session });
            if (!deleted) throw new ApiError(404, 'User not found');
            await Task.updateMany(
                { assignedUser: req.params.id },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
                { session }
            );
        });
    } finally { await session.endSession(); }
    return res.status(204).send();
}));

module.exports = router;

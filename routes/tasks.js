const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError, response, parseJson, collectionQuery, validId, cleanString, asyncRoute } = require('./helpers');

const router = express.Router();

function taskInput(body) {
    const name = cleanString(body.name);
    if (!name) throw new ApiError(400, 'Invalid task', 'A non-empty name is required.');
    if (body.deadline === undefined || body.deadline === null || body.deadline === '' || !['string', 'number'].includes(typeof body.deadline)) {
        throw new ApiError(400, 'Invalid task', 'A valid deadline is required.');
    }
    const deadline = new Date(body.deadline);
    if (Number.isNaN(deadline.getTime())) throw new ApiError(400, 'Invalid task', 'A valid deadline is required.');
    if (body.description !== undefined && typeof body.description !== 'string') throw new ApiError(400, 'Invalid task', 'description must be a string.');
    if (body.completed !== undefined && typeof body.completed !== 'boolean') throw new ApiError(400, 'Invalid task', 'completed must be a boolean.');
    if (body.assignedUser !== undefined && typeof body.assignedUser !== 'string') throw new ApiError(400, 'Invalid task', 'assignedUser must be a string.');
    if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') throw new ApiError(400, 'Invalid task', 'assignedUserName must be a string.');
    const assignedUser = body.assignedUser || '';
    if (assignedUser && !validId(assignedUser)) throw new ApiError(400, 'Invalid task', 'assignedUser must be a valid id.');
    return {
        name,
        description: body.description === undefined ? '' : body.description,
        deadline,
        completed: body.completed === undefined ? false : body.completed,
        assignedUser,
        requestedUserName: body.assignedUserName
    };
}

async function assignment(input, session) {
    if (!input.assignedUser) return { user: null, name: 'unassigned' };
    const user = await User.findById(input.assignedUser).session(session);
    if (!user) throw new ApiError(404, 'User not found', 'The assigned user does not exist.');
    if (input.requestedUserName !== undefined && input.requestedUserName !== user.name) {
        throw new ApiError(400, 'Invalid assignment', 'assignedUserName does not match assignedUser.');
    }
    return { user, name: user.name };
}

async function syncUsers(task, oldAssignedUser, user, session) {
    const taskId = String(task._id);
    if (oldAssignedUser && (oldAssignedUser !== task.assignedUser || task.completed || !task.assignedUser)) {
        await User.updateOne({ _id: oldAssignedUser }, { $pull: { pendingTasks: taskId } }, { session });
    }
    if (user) {
        const update = task.completed ? { $pull: { pendingTasks: taskId } } : { $addToSet: { pendingTasks: taskId } };
        await User.updateOne({ _id: user._id }, update, { session });
    }
}

router.get('/', asyncRoute(async (req, res) => {
    const data = await collectionQuery(Task, req.query, 100);
    return response(res, 200, 'OK', data);
}));

router.post('/', asyncRoute(async (req, res) => {
    const input = taskInput(req.body);
    const session = await mongoose.startSession();
    let created;
    try {
        await session.withTransaction(async () => {
            const assigned = await assignment(input, session);
            [created] = await Task.create([{
                name: input.name, description: input.description, deadline: input.deadline,
                completed: input.completed, assignedUser: input.assignedUser, assignedUserName: assigned.name
            }], { session });
            await syncUsers(created, '', assigned.user, session);
        });
    } finally { await session.endSession(); }
    return response(res, 201, 'Task created', created);
}));

router.get('/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) throw new ApiError(404, 'Task not found');
    const select = parseJson(req.query.select, 'select');
    let query = Task.findById(req.params.id);
    if (select) query = query.select(select);
    const task = await query;
    if (!task) throw new ApiError(404, 'Task not found');
    return response(res, 200, 'OK', task);
}));

router.put('/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id) || !(await Task.exists({ _id: req.params.id }))) throw new ApiError(404, 'Task not found');
    const input = taskInput(req.body);
    const session = await mongoose.startSession();
    let updated;
    try {
        await session.withTransaction(async () => {
            const task = await Task.findById(req.params.id).session(session);
            if (!task) throw new ApiError(404, 'Task not found');
            const assigned = await assignment(input, session);
            const oldAssignedUser = task.assignedUser;
            task.name = input.name;
            task.description = input.description;
            task.deadline = input.deadline;
            task.completed = input.completed;
            task.assignedUser = input.assignedUser;
            task.assignedUserName = assigned.name;
            updated = await task.save({ session });
            await syncUsers(updated, oldAssignedUser, assigned.user, session);
        });
    } finally { await session.endSession(); }
    return response(res, 200, 'Task updated', updated);
}));

router.delete('/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id) || !(await Task.exists({ _id: req.params.id }))) throw new ApiError(404, 'Task not found');
    const session = await mongoose.startSession();
    let deleted;
    try {
        await session.withTransaction(async () => {
            deleted = await Task.findByIdAndDelete(req.params.id, { session });
            if (!deleted) throw new ApiError(404, 'Task not found');
            if (deleted.assignedUser) {
                await User.updateOne({ _id: deleted.assignedUser }, { $pull: { pendingTasks: String(deleted._id) } }, { session });
            }
        });
    } finally { await session.endSession(); }
    return res.status(204).send();
}));

module.exports = router;

const mongoose = require('mongoose');

class ApiError extends Error {
    constructor(status, message, data = null) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

function response(res, status, message, data) {
    return res.status(status).json({ message, data });
}

function parseJson(value, name) {
    if (value === undefined) return undefined;
    try {
        const result = JSON.parse(value);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
        return result;
    } catch (_) {
        throw new ApiError(400, `Invalid ${name} parameter`, `${name} must be a JSON object.`);
    }
}

function parseInteger(value, name, defaultValue) {
    if (value === undefined) return defaultValue;
    if (!/^\d+$/.test(String(value))) throw new ApiError(400, `Invalid ${name} parameter`, `${name} must be a non-negative integer.`);
    return Number(value);
}

function collectionQuery(model, params, defaultLimit) {
    const where = parseJson(params.where, 'where') || {};
    const sort = parseJson(params.sort, 'sort');
    const select = parseJson(params.select, 'select');
    const skip = parseInteger(params.skip, 'skip', 0);
    const limit = parseInteger(params.limit, 'limit', defaultLimit);
    const count = params.count === true || params.count === 'true';
    if (params.count !== undefined && ![true, false, 'true', 'false'].includes(params.count)) {
        throw new ApiError(400, 'Invalid count parameter', 'count must be true or false.');
    }
    if (count) return model.countDocuments(where).skip(skip).limit(limit === undefined ? 0 : limit);
    let query = model.find(where);
    if (sort) query = query.sort(sort);
    if (select) query = query.select(select);
    if (skip) query = query.skip(skip);
    if (limit !== undefined) query = query.limit(limit);
    return query;
}

function validId(id) {
    return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function asyncRoute(handler) {
    return function (req, res, next) {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
}

module.exports = { ApiError, response, parseJson, collectionQuery, validId, cleanString, asyncRoute };

"use strict";

const functions = require('firebase-functions');

const MM_INTEGRATION_TOKEN = functions.config().mattermost.token;
const BASE_URL = functions.config().functions.baseurl;

function deepCopy(object) {
  return JSON.parse(JSON.stringify(object));
}

function isValidToken(token){
  let tokens = MM_INTEGRATION_TOKEN?MM_INTEGRATION_TOKEN.split(','):[];
  return token && tokens.indexOf(token) !== -1;
}

function isValidSlashRequest(req){
  if (req.body && isValidToken(req.body.token)) {
    return true;
  } else {
    console.warn('Invalid request or missing token');
    return false;
  }
}

function isValidAdminRequest(req) {
    let token = req.query.token || req.header('token') || '';
    return isValidToken(token);
}

function isValidActionRequest(req) {
  if (req.body && req.body.context && isValidToken(req.body.context.token)) {
    return true;
  } else {
    console.warn('Invalid request or missing token');
    return false;
  }
}

function buildAction(icon, name, color, urlStub, todo, token, optionKey) {
  let actionNode = {
      name: `${icon} ${name}`,
      color,
      integration: {
          url: BASE_URL + urlStub,
          context: {
              id: todo.id,
              key: todo.key,
              token: token,
              teamId: todo.teamId,
              channelId: todo.channelId,
              optionKey
          }
      }
  };
  
  console.log('creating action:', actionNode);
  return actionNode;
}

function isRequestorOwnerOfPoll(request, poll){
  const userId = request.body.user_id;
  const createdByUserId = poll.createdByUserId;
  return userId === createdByUserId;
}


function multiline() {
    let args = Array.from(arguments);
    let reducer = (acc, v) => acc + '\n' + v;
    return args.reduce(reducer);
}

function summarizeTodos(todos) {
    if (todos.length > 0) {
        let lines = [];
        lines.push('---');
        lines.push('### Tasks of channel');
        lines.push('');
        lines.push('| ID | Task | Created By | Created At | Key |')
        lines.push('|:-------:|:--------|:-------:|:-------:|:-------:|')
        todos.forEach((todo, index) => {
          lines.push(`| ${todo.id||'?'} | ${todo.title} | ${todo.createdBy} | ${todo.createdAt} | ${todo.key} |`);
        });
        lines.push('---');
        return multiline(...lines);
    } else {
      return "No task found.";
    }
}

module.exports = {
  deepCopy,
  isValidSlashRequest,
  isValidActionRequest,
  isValidAdminRequest,
  buildAction,
  isRequestorOwnerOfPoll,
  summarizeTodos,
  multiline
};
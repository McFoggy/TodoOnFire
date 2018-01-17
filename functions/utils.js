"use strict";

const functions = require('firebase-functions');
const _ = require('lodash');

const MM_INTEGRATION_TOKEN = functions.config().mattermost.token;
const CONFIG = functions.config();
const BASE_URL = functions.config().functions.baseurl;

function baseURL() {
    return BASE_URL;
}

function adminTokenTarget() {
    let channel = CONFIG.mattermost.tokens.request.channel;
    let mention = CONFIG.mattermost.tokens.request.mention;
    return {
        channel, 
        mention
    };
}


function deepCopy(object) {
  return JSON.parse(JSON.stringify(object));
}

function isValidAdminToken(token, teamId, channelId) {
    let tokenPaths = [];
    if (teamId && channelId) {
        tokenPaths.push(`mattermost.team.${teamId}.channel.${channelId}.token`);
    }
    if (teamId) {
        tokenPaths.push(`mattermost.team.${teamId}.token`);
    }
    tokenPaths.push('mattermost.token');

    for (var i = 0; i < tokenPaths.length; i++) {
        let tokenPath = tokenPaths[i];
        let foundTokenDefinition = _.head(_.at(CONFIG, tokenPath));
        console.log(`comparing token '${token}' using definition: '${foundTokenDefinition}' from ${tokenPath}`);
        if (foundTokenDefinition && isValidTokenFromDefinition(token, foundTokenDefinition)) {
            return true;
        }
    }
    
    return false;
}

function isValidTokenFromDefinition(token, tokenDefinition) {
    let tokens = tokenDefinition?tokenDefinition.split(','):[];
    return token && tokens.indexOf(token) !== -1;
}

function isValidToken(token){
    return isValidTokenFromDefinition(token, MM_INTEGRATION_TOKEN);
}

function isValidSlashRequest(req){
  if (req.body && isValidToken(req.body.token)) {
    return true;
  } else {
    console.warn('Invalid request or missing token');
    return false;
  }
}

function ephemeralResponse(text) {
    return {
        response_type: 'ephemeral',
        text: text
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
  baseURL, 
  adminTokenTarget,
  isValidSlashRequest,
  isValidActionRequest,
  isValidAdminRequest,
  isValidAdminToken,
  buildAction,
  isRequestorOwnerOfPoll,
  summarizeTodos,
  multiline,
  ephemeralResponse
};
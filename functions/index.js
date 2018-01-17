"use strict";

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const utils = require('./utils');
const _ = require('lodash');

const ALL_KEYWORD = 'all';

admin.initializeApp(functions.config().firebase);

function key(teamId, channelId) {
    return `${teamId}-${channelId}`;
}

function path(teamId, channelId) {
    return `/todos/${teamId}-${channelId}`;
}

function todoById(todos, id) {
    return new Promise((resolve, reject) => {
        console.log('parsing todos', todos);

        const todoKeys = todos ? Object.keys(todos): [];
        let todoFound = null;
        for (const todoKey of todoKeys) {
            let todo = todos[todoKey];
            if (todo.id === id) {
                todoFound = todo;
                break;
            }
        }

        if (todoFound) {
            resolve(todoFound);
        } else {
            reject(`no todo found with id[${id}]`);
        }
    });
}

function channelReference(teamId, channelId) {
    return new Promise((resolve, reject) => {
        let channelRef = admin.database().ref('/todos').child(key(teamId, channelId));
        channelRef.transaction(function(existingData) {
            if (existingData === null) {
                const createdAt = new Date().toISOString();
                return {
                    createdAt,
                    teamId,
                    channelId,
                    todos: {},
                    counter: 0
                }
            }
        })
            .then((commited, snapshot) => {
                if (commited) {
                    resolve(channelRef);
                } else {
                    reject('no initialization occured');
                }
            })
            .catch(reason => {
                reject(reason);
            });
    });
}

function incCounter(channelreference) {
    return new Promise((resolve, reject) => {
        channelreference.child("counter").transaction(
            current => (current || 0)+1
            , (err, committed, snapshot) => {
                if (err) {
                    reject('error updating counter');
                } else if(!committed) {
                    reject('cannot update counter');
                } else {
                    resolve(snapshot.val());
                }
            }
            , false
        );
    });
}

function todosReferenceFromChannelReference(channelRef) {
    return channelRef.child("todos");
}

function askToken(httpReq, httpRes, message) {
    let userMessage = message || 'no message provided';
    let teamId = httpReq.body.team_id;
    let channelId = httpReq.body.channel_id;
    let username =  httpReq.body.user_name;
    let channelName = httpReq.body.channel_name;
    
    let tokenConfigTarget = utils.adminTokenTarget();

    if (tokenConfigTarget.mention || tokenConfigTarget.channel) {
        let responseObject = {
            channel: tokenConfigTarget.channel || channelName,
            response_type: "in_channel",
            text: utils.multiline(
                `@channel ${tokenConfigTarget.mention || ''} @${username} requested an admin token.`,
                `- team: \`${teamId}\``,
                `- channel: \`${teamId}\``,
                ``,
                `### Message`,
                userMessage
            )
        };

        httpRes.set('Content-Type', 'application/json');
        return httpRes.status(200).send(JSON.stringify(responseObject));
    } else {
        httpRes.set('Content-Type', 'application/json');
        return httpRes.status(200).send(JSON.stringify(utils.ephemeralResponse(`no target defined for token request, contact your administrator`)));
    }
}

function removeTodo(httpReq, httpRes, which, token) {
    const teamId = httpReq.body.team_id;
    const channelId = httpReq.body.channel_id;

    if (!utils.isValidAdminToken(token, teamId, channelId)) {
        return httpRes.status(401).send('Invalid request or missing token');
    }
    
    if (ALL_KEYWORD === which) {
        return channelReference(teamId, channelId)
            .then(todosReferenceFromChannelReference)
            .then((ref) => {
                return ref.remove();
            })
            .then(() => {
                httpRes.set('Content-Type', 'application/json');
                return httpRes.status(200).send(JSON.stringify(utils.ephemeralResponse(`all tasks of channel removed`)));
            })
            .catch(reason => {
                httpRes.set('Content-Type', 'application/json');
                return httpRes.status(200).send(JSON.stringify(utils.ephemeralResponse(`cannot remove todos of channel: [${reason}]`)));
            });
    } else {
        let id = Number.parseInt(which);
        if (Number.isNaN(id)) {
            httpRes.set('Content-Type', 'application/json');
            return httpRes.status(200).send(JSON.stringify(utils.ephemeralResponse(`cannot remove todos with id: [${which}]`)));
        }

        return channelReference(teamId, channelId)
            .then(todosReferenceFromChannelReference)
            .then((refTodos) => {
                return refTodos.once('value').then((snap) => snap.val());
            })
            .then((todos) => {
                return todoById(todos, id);
            })
            .then((todo) => todo.key)
            .then((key) => {
                return channelReference(teamId, channelId)
                    .then(todosReferenceFromChannelReference)
                    .then((refTodos) => refTodos.child(key));
            })
            .then((todoRef) => {
                console.log('about to remove:', todoRef.toString());
                return todoRef.remove();
            })
            .then(() => {
                httpRes.set('Content-Type', 'application/json');
                return httpRes.status(200).send(JSON.stringify(utils.ephemeralResponse(`task ${id} has been removed`)));
            })
            .catch(reason => {
                httpRes.set('Content-Type', 'application/json');
                return httpRes.status(200).send(JSON.stringify(utils.ephemeralResponse(`cannot remove task ${id} from channel: [${reason}]`)));
            });
    }
}

function usage(httpRes) {
    const returnObject = {
        "response_type": "ephemeral",
        "text": utils.multiline(
            'Usage:',
            '- `/todo`: prints this usage',
            '- `/todo list`: list todos of the current channel',
            '- `/todo add | TASK [| DESCRIPTION]` : add a todo item for TASK, optionally described by DESCRIPTION',
            '- `/todo ID` : prints details of task identified by the given ID',
            '- `/todo remove | [ID or ALL] | TOKEN`: removes the todo with given ID or ALL. Token is either the channel token or a global one (team or system)'
        )
    };
    // '- `/todo token | message`: asks the administrator to receive an admin token for this channel'

    httpRes.set('Content-Type', 'application/json');
    return httpRes.status(200).send(JSON.stringify(returnObject));
}

function list(httpReq, httpRes) {
    const teamId = httpReq.body.team_id;
    const channelId =  httpReq.body.channel_id;

    return channelReference(teamId, channelId)
        .then(todosReferenceFromChannelReference)
        .then((ref) => {
            return ref.once('value');
        })
        .then((todosSnapshot) => {
            let todosArray = [];
            const todos = todosSnapshot.val();
            const todoKeys = todos ? Object.keys(todos): [];
            for (const todoKey of todoKeys) {
                const todo = todos[todoKey];
                console.log(`todo[${todoKey}]`, todo);
                todosArray.push(todo);
            }
            return todosArray;
        })
        .then((todos) => {
            const returnObject = {
                response_type: 'ephemeral',
                text: utils.summarizeTodos(todos)
            };

            httpRes.set('Content-Type', 'application/json');
            return httpRes.status(200).send(JSON.stringify(returnObject));
        });
}

function add(httpReq, httpRes, todoTitle, todoDescription) {
  const createdAt = new Date().toISOString();
  const teamId = httpReq.body.team_id;
  const channelId =  httpReq.body.channel_id;
  
  if (!todoTitle) {
      return usage(httpRes);
  }
  
  const title = todoTitle.trim();
  const description = todoDescription?todoDescription.trim():'no description provided during task creation';

  return channelReference(teamId, channelId)
      .then (channelReference => {
          return Promise.all([incCounter(channelReference), Promise.resolve(todosReferenceFromChannelReference(channelReference))]); 
      })
      .then(results => {
          let id = results[0];
          let ref = results[1];
          const nodeRef = ref.push();
          let todoNode = {
              id: id,
              key: nodeRef.key,
              createdBy: httpReq.body.user_name,
              createdByUserId: httpReq.body.user_id,
              createdAt,
              teamId,
              channelId,
              done: false,
              title,
              description
          };

          console.log('Adding todo', todoNode);
          nodeRef.set(todoNode);
          return todoNode;
      })
      .then((node) => {
        const returnObject = {
          response_type: 'ephemeral',
          text: 'new task created with id: ' + node.id
        };
        httpRes.set('Content-Type', 'application/json');
        return httpRes.status(200).send(JSON.stringify(returnObject));
      })
      .catch(error => {
          console.error('Error creating todos: ', error);
          const returnObject = {
              response_type: 'ephemeral',
              text: `There was an error creating the task: ${error}`
          };
          httpRes.set('Content-Type', 'application/json');
          return httpRes.status(200).send(JSON.stringify(returnObject));
      });
}

function buildTodoResponseDetail(todo, token) {
    const returnObject = {
        response_type: 'in_channel',
        "attachments": [
            {
                "fallback": `${todo.title} by ${todo.createdBy} on ${todo.createdAt}`,
                "color": "#97a1ff",
                "text": todo.description,
                "author_name": todo.createdBy,
                "title": todo.title,
                "fields": [
                    {
                        "short": false,
                        "title": "Creation date",
                        "value": todo.createdAt
                    },
                    {
                        "short": true,
                        "title": "Id",
                        "value": todo.id
                    }
                ],
                "actions": [
                    utils.buildAction('☠', 'Close', null, '/todoClose', todo, token)
                ]
            }
        ]
    };
    console.log('retuning todo detail', returnObject);
    return returnObject;
}

function todoFromSnapshot(todoSnapshot, token, keyName, keyValue) {
    console.log(`Providing detail of ${keyName}[${keyValue}]`);
    if (!todoSnapshot.exists()) {
        throw `no todo with ${keyName}[${keyValue}] could be found`;
    }
    let todo = todoSnapshot.val();
    return buildTodoResponseDetail(todo, token);
}

function detail(httpReq, httpRes, id) {
    const teamId = httpReq.body.team_id;
    const channelId =  httpReq.body.channel_id;

    return channelReference(teamId, channelId)
        .then(todosReferenceFromChannelReference)
        .then((ref) => {
            return ref.once('value');
        })
        .then((todosSnapshot) => {
            const idAsInt = parseInt(id, 10);
            const todos = todosSnapshot.val();
            
            return todoById(todos, idAsInt);
        })
        // .then(ref => {
        //     let idAsInt = parseInt(id, 10);
        //     let todoRef = ref.orderByChild("id").equalTo(idAsInt).limitToFirst(1);
        //     console.log(`reading todo by id[${idAsInt}]: ${todoRef.toString()}`);
        //     return todoRef.once('value');
        // })
        // .then(snapshot => todoFromSnapshot(snapshot, httpReq.body.token, 'id', id))
        .then(todo => {
            return buildTodoResponseDetail(todo, httpReq.body.token);
        })
        .then(todo => {
            console.log('returning to mattermost', todo);
            httpRes.set('Content-Type', 'application/json');
            return httpRes.status(200).send(JSON.stringify(todo));
        })
        .catch(reason => {
            console.error('cannot provide todo detail', reason);
            httpRes.set('Content-Type', 'application/json');
            return httpRes.status(200).send(JSON.stringify(utils.ephemeralResponse(`No task found with id[${id}]`)));
        });
}

exports.slashTodo = functions.https.onRequest((req, res) => {
    console.log('Received body: ', req.body);

    if (!utils.isValidSlashRequest(req)) {
        return res.status(401).send('Invalid request or missing token');
    }
    const token = req.body.token;
    const textPieces = req.body.text ? req.body.text.trim().split("|") : [];

    if (textPieces.length <= 0) {
        console.info('No arguments provided, showing usage');
        return usage(res);
    }
    
    const command = textPieces[0].trim();
    console.info(`About to execute command: "${command}"`);
    switch (command) {
        case "list": {
            return list(req, res);
        }
        case "remove": {
            const which = (textPieces[1] || '').trim().toLowerCase();
            const adminToken = (textPieces[2] || '').trim();
            return removeTodo(req, res, which, adminToken);
        }
        // case "admin":
        //     let adminCommand = textPieces[1].trim();
        //     let which = (textPieces[2] || '').trim().toLowerCase();
        //     let adminToken = textPieces[3].trim();
        //     return doAdmin(req, res, adminCommand, which, adminToken);
        case "add": {
            const task = textPieces[1].trim();
            const taskDescription = textPieces[2];
            return add(req, res, task, taskDescription);
        }
        case "token": {
            const message = textPieces[1].trim();
            return askToken(req, res, message);
        }
        default: {
            if (command.trim().length > 0) {
                return detail(req, res, command);
            }
            return usage(res);
        }
    }
});

exports.todoClose = functions.https.onRequest((req, res) => {
    console.log('Closing: ', req.body);

    if (!utils.isValidActionRequest(req)) {
        console.error('Could not find token to proceed for closing');
        return res.status(401).send('Invalid request or missing token');
    }
    
    const teamId = req.body.context.teamId;
    const channelId = req.body.context.channelId;
    const key = req.body.context.key;
    const id = req.body.context.id;

    return channelReference(teamId, channelId)
        .then(todosReferenceFromChannelReference)
        .then((ref) => {
            return ref.child(key).once('value')
                .then((todoSnapshot) => {
                    if (!todoSnapshot.exists()) {
                        throw 'to task found with given key';
                    }
                    if (req.body.user_id !== todoSnapshot.val().createdByUserId) {
                        throw 'task can only be closed by creator';
                    }
                    return ref.child(key).remove();
                });
        })
        .then(() => {
            let completedMessage = `Task ${id} has been completed on ` + new Date().toISOString();
            const returnObject = {
                update: {
                    message: completedMessage
                },
                ephemeral_text: `You completed the task[${id}]!`
            };
            console.log('Closed: ', returnObject);
            res.set('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(returnObject));
        })
        .catch(failure => {
            const failureMessage = failure?failure:'unknown failure';
            console.error('Cannot close: ' + failureMessage, failure);
            const returnObject = {
                ephemeral_text: `Cannot complete task[${id}]: ${failureMessage}`
            };
            res.set('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(returnObject));
        });
});

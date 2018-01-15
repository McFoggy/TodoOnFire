"use strict";

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const utils = require('./utils');

admin.initializeApp(functions.config().firebase);

function key(teamId, channelId) {
    return `${teamId}-${channelId}`;
}

function path(teamId, channelId) {
    return `/todos/${teamId}-${channelId}`;
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

function usage(httpRes) {
    const returnObject = {
        "response_type": "ephemeral",
        "text": utils.multiline(
            'Usage:',
            '- `/todo`: prints this usage',
            '- `/todo list`: list todos of the current channel',
            '- `/todo add | TASK [| DESCRIPTION]` : add a todo item for TASK, optionally described by DESCRIPTION',
            '- `/todo ID` : prints details of task identified by the given ID',
            '- `/todo key | KEY` : prints details of task identified by the given KEY'
        )
    };
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
          text: 'new task created under key: ' + node.key
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
                        "title": "Key",
                        "value": todo.key
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
            const todos = todosSnapshot.val();
            console.log('parsing todos', todos);

            const todoKeys = todos ? Object.keys(todos): [];
            const idAsInt = parseInt(id, 10);
            for (const todoKey of todoKeys) {
                let todo = todos[todoKey];
                if (todo.id === idAsInt) {
                    return todo;
                }
            }
            
            throw `no todo found with id[${id}]`;
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
            const returnObject = {
                response_type: 'ephemeral',
                text: `No task found with id[${id}]`
            };
            httpRes.set('Content-Type', 'application/json');
            return httpRes.status(200).send(JSON.stringify(returnObject));
        });
}

function detailByKey(httpReq, httpRes, key) {
    const teamId = httpReq.body.team_id;
    const channelId =  httpReq.body.channel_id;

    if (!key) {
        httpRes.set('Content-Type', 'application/json');
        return httpRes.status(400).send(JSON.stringify({error: 'no key given to retrieve todo item'}));
    }
    let todoKey = key.trim();

    return channelReference(teamId, channelId)
        .then(todosReferenceFromChannelReference)
        .then((ref) => {
            let todoRef = ref.child(todoKey);
            console.log(`reading todo by key[${todoKey}]: ${todoRef.toString()}`);
            return todoRef.once('value');
        })
        .then(snapshot => todoFromSnapshot(snapshot, httpReq.body.token, 'key', todoKey))
        .then(todo => {
            console.log('returning to mattermost', todo);
            httpRes.set('Content-Type', 'application/json');
            return httpRes.status(200).send(JSON.stringify(todo));
        })
        .catch(reason => {
            console.error('cannot provide todo detail', reason);
            const returnObject = {
                response_type: 'ephemeral',
                text: `No task found with key[${todoKey}]`
            };
            httpRes.set('Content-Type', 'application/json');
            return httpRes.status(200).send(JSON.stringify(returnObject));
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
        case "list":
            return list(req, res);
        case "add":
            const task = textPieces[1].trim();
            const taskDescription = textPieces[2];
            return add(req, res, task, taskDescription);
        case "key":
            const key = textPieces[1];
            return detailByKey(req, res, key);
        default:
            if (command.trim().length > 0) {
                return detail(req, res, command);
            }
            return usage(res);
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
            let completedMessage = "Task has been completed on " + new Date().toISOString();
            const returnObject = {
                update: {
                    message: completedMessage
                },
                ephemeral_text: `You completed the task[${key}]!`
            };
            console.log('Closed: ', returnObject);
            res.set('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(returnObject));
        })
        .catch(failure => {
            const failureMessage = failure?failure:'unknown failure';
            console.error('Cannot close: ' + failureMessage, failure);
            const returnObject = {
                response_type: "ephemeral",
                text: `Cannot complete task[${key}]: ${failureMessage}`
            };
            res.set('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(returnObject));
        });
});

exports.cleanAll = functions.https.onRequest((req, res) => {
    admin.database().ref('/todos').remove().then(() => {
        res.set('Content-Type', 'text/plain');
        return res.status(200).send('done');

    }).catch(err => {
        res.set('Content-Type', 'text/plain');
        return res.status(400).send('error:' + JSON.stringify(err));
    });
});

exports.readAll = functions.https.onRequest((req, res) => {
    admin.database().ref('/todos').once('value').then((snapshot) => {
        if (snapshot.exists()) {
            res.set('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(snapshot.val()));
        } else {
            res.set('Content-Type', 'text/plain');
            return res.status(204).send('no content');
        }
    }).catch(err => {
        res.set('Content-Type', 'text/plain');
        return res.status(400).send('error:' + JSON.stringify(err));
    });
});

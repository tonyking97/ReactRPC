const { reactWrapper } = require("./lib/wrap-original.js");
const { grpc } = require("@improbable-eng/grpc-web");

class improbRPC {
  constructor() {
    this.client={};
    this.messages={};
    this.url_name={};
    this.functions={};
  }

  build (requests, clients, URL) {
    this.url_name = URL;
    //map all of requests
    if (requests instanceof Array) {
      for (let i = 0; i < requests.length; i++) {
        for (let props in requests[i]) {
          if (requests[i].hasOwnProperty(props)) {
            this.messages[props] = requests[i][props];
          }
        }
      }
    } else {
      this.messages = requests;
    }
    if (clients instanceof Array) {
      for (let i = 0; i < clients.length; i++) {
        for (let props in clients[i]) {
          if (clients[i].hasOwnProperty(props)) {
            this.client[props] = clients[i][props];
          }
        }
      }
    } else {
      this.client = clients;
    }
    for (let service in this.client) {
      if (this.client.hasOwnProperty(service)) {
        this.functions[service] = {};
        for (let keys in this.client[service]) {
          if (
              this.client[service].hasOwnProperty(keys) &&
              typeof this.client[service][keys] !== "string"
          ) {
            this.functions[service][keys] = this.improbableCreator(
                service,
                keys,
            );
          }
        }
      }
    }
  }

  improbableCreator(service, method) {
    const messages = this.messages;
    const client = this.client;
    const url_name = this.url_name;
    return function(data, meta, cb = undefined) {
      if (typeof data === "object" && data !== null) {
        let req = serialize(data, messages);
        let user = grpc.client(client[service][method], {
          host: url_name
        });
        user.start(grpc.Metadata(meta));
        user.send(req);
        if (cb !== undefined) {
          user.onMessage(res => {
            return cb(null, res.toObject());
          });
        } else {
          user.sendMessage = function(obj) {
            return user.send(serialize(obj));
          };
          user.on = function(event, cb) {
            switch (event) {
              case "data":
                user.onMessage(cb);
                break;
              case "status":
                user.onHeaders(cb);
                break;
              case "end":
                user.onEnd(cb);
                break;
              default:
                throw new Error("Not valid listener");
            }
          };
        }
        return user;
      } else {
        throw new Error(
            "First parameter must be an object with messageType defined"
        );
      }
    };
  }

  wrapper(WrappedComponent) {
    return reactWrapper(WrappedComponent, this.functions);
  };
}

class googleRPC {
  constructor() {
    this.client={};
    this.messages={};
    this.url_name={};
    this.functions={};
  }

  build(
      requests,
      clients,
      URL,
      config = null,
      security = null
  ) {
    //Maps all the requests from the pb file to googleRPC
    if (requests instanceof Array) {
      for (let i = 0; i < requests.length; i++) {
        for (let props in requests[i]) {
          if (requests[i].hasOwnProperty(props)) {
            this.messages[props] = requests[i][props];
          }
        }
      }
    } else {
      this.messages = requests;
    }

    if (clients instanceof Array) {
      for (let i = 0; i < clients.length; i++) {
        for (let props in clients[i]) {
          if (clients[i].hasOwnProperty(props)) {
            if (
                /*props.length > 13 &&*/ props.slice(props.length - 6) ===
                "Client" &&
                !props.includes("Promise")
            ) {
              this.client[props.slice(0, props.length - 6)] = clients[i][props];
            }
          }
        }
      }
    } else {
      for (let props in clients) {
        if (clients.hasOwnProperty(props)) {
          if (
              props.slice(props.length - 6) === "Client" &&
              !props.includes("Promise")
          ) {
            this.client[props.slice(0, props.length - 6)] = clients[props];
          }
        }
      }
    }

    for (let props in this.client) {
      if (this.client.hasOwnProperty(props)) {
        this.ServiceCreator(props, URL, config, security);
      }
    }
  };

  ServiceCreator(clientName, URL, config = null, security = null) {
    //Dynamically create new client with passed in URL
    this.functions[clientName] = {};
    const currClient = new this.client[clientName](URL, config, security);
    for (let serviceCall in currClient) {
      if (!currClient.hasOwnProperty(serviceCall)) {
        this.functions[clientName][serviceCall] = function(data, ...args) {
          //Make sure data recieved is an object before sending it to serialize
          if (typeof data === "object" && data !== null) {
            let req = serialize(data, this.messages);
            const stream = currClient[serviceCall](req, ...args);
            //Add improbable's streaming calls to create uniformity for users
            if (typeof stream === "object") {
              stream.onMessage = function(cb) {
                stream.on("data", cb);
              };
              stream.onHeaders = function(cb) {
                stream.on("status", cb);
              };
              stream.onEnd = function(cb) {
                stream.on("end", cb);
              };
            }
            return stream;
          } else {
            throw new Error(
                "First parameter must be an object with messageType defined"
            );
          }
        };
      }
    }
  }

  wrapper(WrappedComponent) {
    return reactWrapper(WrappedComponent, this.functions);
  };

}

function serialize(data, messages) {
  //Build in check if data is an object/array. If not, just return the value
  if (Array.isArray(data)) {
    throw new Error("Type must be an object or primitive");
  }
  if (typeof data !== "object" || data === null) {
    return data;
  }
  //Check to make sure that the user has given a non null messageType property
  if (!data["msgType"]) {
    throw new Error("MessageType not specified!");
  }
  //Check that the messageType exists in the messages object
  if (!messages[data["msgType"]]) {
    throw new Error("MessageType is invalid");
  }
  //Create a new instance of the message object using the messgeType property that the user defines for us
  let newMessage = new messages[data["msgType"]]();
  for (let prop in data) {
    //Loop through all the properties in the object that are not messageType
    if (data.hasOwnProperty(prop) && prop !== "msgType") {
      //If data is an array we need to do a for loop and recursively turn each element into a message object to add
      if (Array.isArray(data[prop])) {
        //find the addElement key
        let newKey =
            "add" + prop[0].toUpperCase() + prop.slice(1).toLowerCase();
        //If addElement method is undefined throw Error saying cannot find the proper method
        //Otherwise loop through array and add all the elements to the method

        if (typeof data === "object") {
          if (newMessage[newKey] !== undefined) {
            for (let el of data[prop]) {
              let val = serialize(el, messages);
              newMessage[newKey](val);
            }
          } else {
            throw new Error("Message field is invalid: " + prop);
          }
        } else {
          if (newMessage[newKey] !== undefined) {
            for (let el of data[prop]) {
              let val = serialize(data[prop][el], messages);
              newMessage[newKey](val);
            }
          } else {
            throw new Error("Message field is invalid: " + prop);
          }
        }
      } else {
        //Otherwise we just set the field with the value of the property
        let newKey =
            "set" + prop[0].toUpperCase() + prop.slice(1).toLowerCase();
        //If method cannot be found throw error
        if (newMessage[newKey] !== undefined) {
          let val = serialize(data[prop], messages);
          newMessage[newKey](val);
        } else {
          throw new Error("Message field is invalid: " + prop);
        }
      }
    }
  }
  return newMessage;
}

module.exports = { improbRPC, googleRPC };

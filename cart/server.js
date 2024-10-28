// const instanaAvailable = process.env.INSTANA_AGENT_AVAILABLE === 'true';
// let instana;
// if (instanaAvailable) {
//     instana = require('@instana/collector')({
//         agentHost: process.env.INSTANA_AGENT_HOST || 'localhost',
//         tracing: { enabled: true }
//     });
//     console.log("Instana initialized.");
// } else {
//     console.log("Instana not initialized as agent is unavailable.");
// }

// const redis = require('redis');
// const request = require('request');
// const bodyParser = require('body-parser');
// const express = require('express');
// const pino = require('pino');
// const expPino = require('express-pino-logger');
// // Prometheus
// const promClient = require('prom-client');
// const Registry = promClient.Registry;
// const register = new Registry();
// const counter = new promClient.Counter({
//     name: 'items_added',
//     help: 'running count of items added to cart',
//     registers: [register]
// });


// var redisConnected = false;

// var redisHost = process.env.REDIS_HOST || 'redis'
// var catalogueHost = process.env.CATALOGUE_HOST || 'catalogue'
// var cataloguePort = process.env.CATALOGUE_PORT || '8080'

// const logger = pino({
//     level: 'info',
//     prettyPrint: false,
//     useLevelLabels: true
// });
// const expLogger = expPino({
//     logger: logger
// });

// const app = express();

// app.use(expLogger);

// app.use((req, res, next) => {
//     res.set('Timing-Allow-Origin', '*');
//     res.set('Access-Control-Allow-Origin', '*');
//     next();
// });

// app.use((req, res, next) => {
//     let dcs = [
//         "asia-northeast2",
//         "asia-south1",
//         "europe-west3",
//         "us-east1",
//         "us-west1"
//     ];
//     let span = instana.currentSpan();
//     span.annotate('custom.sdk.tags.datacenter', dcs[Math.floor(Math.random() * dcs.length)]);

//     next();
// });

// app.use(bodyParser.urlencoded({ extended: true }));
// app.use(bodyParser.json());

// app.get('/health', (req, res) => {
//     var stat = {
//         app: 'OK',
//         redis: redisConnected
//     };
//     res.json(stat);
// });

// // Prometheus
// app.get('/metrics', (req, res) => {
//     res.header('Content-Type', 'text/plain');
//     res.send(register.metrics());
// });


// // get cart with id
// app.get('/cart/:id', (req, res) => {
//     redisClient.get(req.params.id, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == null) {
//                 res.status(404).send('cart not found');
//             } else {
//                 res.set('Content-Type', 'application/json');
//                 res.send(data);
//             }
//         }
//     });
// });

// // delete cart with id
// app.delete('/cart/:id', (req, res) => {
//     redisClient.del(req.params.id, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == 1) {
//                 res.send('OK');
//             } else {
//                 res.status(404).send('cart not found');
//             }
//         }
//     });
// });

// // rename cart i.e. at login
// app.get('/rename/:from/:to', (req, res) => {
//     redisClient.get(req.params.from, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == null) {
//                 res.status(404).send('cart not found');
//             } else {
//                 var cart = JSON.parse(data);
//                 saveCart(req.params.to, cart).then((data) => {
//                     res.json(cart);
//                 }).catch((err) => {
//                     req.log.error(err);
//                     res.status(500).send(err);
//                 });
//             }
//         }
//     });
// });

// // update/create cart
// app.get('/add/:id/:sku/:qty', (req, res) => {
//     // check quantity
//     var qty = parseInt(req.params.qty);
//     if(isNaN(qty)) {
//         req.log.warn('quantity not a number');
//         res.status(400).send('quantity must be a number');
//         return;
//     } else if(qty < 1) {
//         req.log.warn('quantity less than one');
//         res.status(400).send('quantity has to be greater than zero');
//         return;
//     }

//     // look up product details
//     getProduct(req.params.sku).then((product) => {
//         req.log.info('got product', product);
//         if(!product) {
//             res.status(404).send('product not found');
//             return;
//         }
//         // is the product in stock?
//         if(product.instock == 0) {
//             res.status(404).send('out of stock');
//             return;
//         }
//         // does the cart already exist?
//         redisClient.get(req.params.id, (err, data) => {
//             if(err) {
//                 req.log.error('ERROR', err);
//                 res.status(500).send(err);
//             } else {
//                 var cart;
//                 if(data == null) {
//                     // create new cart
//                     cart = {
//                         total: 0,
//                         tax: 0,
//                         items: []
//                     };
//                 } else {
//                     cart = JSON.parse(data);
//                 }
//                 req.log.info('got cart', cart);
//                 // add sku to cart
//                 var item = {
//                     qty: qty,
//                     sku: req.params.sku,
//                     name: product.name,
//                     price: product.price,
//                     subtotal: qty * product.price
//                 };
//                 var list = mergeList(cart.items, item, qty);
//                 cart.items = list;
//                 cart.total = calcTotal(cart.items);
//                 // work out tax
//                 cart.tax = calcTax(cart.total);

//                 // save the new cart
//                 saveCart(req.params.id, cart).then((data) => {
//                     counter.inc(qty);
//                     res.json(cart);
//                 }).catch((err) => {
//                     req.log.error(err);
//                     res.status(500).send(err);
//                 });
//             }
//         });
//     }).catch((err) => {
//         req.log.error(err);
//         res.status(500).send(err);
//     });
// });

// // update quantity - remove item when qty == 0
// app.get('/update/:id/:sku/:qty', (req, res) => {
//     // check quantity
//     var qty = parseInt(req.params.qty);
//     if(isNaN(qty)) {
//         req.log.warn('quanity not a number');
//         res.status(400).send('quantity must be a number');
//         return;
//     } else if(qty < 0) {
//         req.log.warn('quantity less than zero');
//         res.status(400).send('negative quantity not allowed');
//         return;
//     }

//     // get the cart
//     redisClient.get(req.params.id, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == null) {
//                 res.status(404).send('cart not found');
//             } else {
//                 var cart = JSON.parse(data);
//                 var idx;
//                 var len = cart.items.length;
//                 for(idx = 0; idx < len; idx++) {
//                     if(cart.items[idx].sku == req.params.sku) {
//                         break;
//                     }
//                 }
//                 if(idx == len) {
//                     // not in list
//                     res.status(404).send('not in cart');
//                 } else {
//                     if(qty == 0) {
//                         cart.items.splice(idx, 1);
//                     } else {
//                         cart.items[idx].qty = qty;
//                         cart.items[idx].subtotal = cart.items[idx].price * qty;
//                     }
//                     cart.total = calcTotal(cart.items);
//                     // work out tax
//                     cart.tax = calcTax(cart.total);
//                     saveCart(req.params.id, cart).then((data) => {
//                         res.json(cart);
//                     }).catch((err) => {
//                         req.log.error(err);
//                         res.status(500).send(err);
//                     });
//                 }
//             }
//         }
//     });
// });

// // add shipping
// app.post('/shipping/:id', (req, res) => {
//     var shipping = req.body;
//     if(shipping.distance === undefined || shipping.cost === undefined || shipping.location == undefined) {
//         req.log.warn('shipping data missing', shipping);
//         res.status(400).send('shipping data missing');
//     } else {
//         // get the cart
//         redisClient.get(req.params.id, (err, data) => {
//             if(err) {
//                 req.log.error('ERROR', err);
//                 res.status(500).send(err);
//             } else {
//                 if(data == null) {
//                     req.log.info('no cart for', req.params.id);
//                     res.status(404).send('cart not found');
//                 } else {
//                     var cart = JSON.parse(data);
//                     var item = {
//                         qty: 1,
//                         sku: 'SHIP',
//                         name: 'shipping to ' + shipping.location,
//                         price: shipping.cost,
//                         subtotal: shipping.cost
//                     };
//                     // check shipping already in the cart
//                     var idx;
//                     var len = cart.items.length;
//                     for(idx = 0; idx < len; idx++) {
//                         if(cart.items[idx].sku == item.sku) {
//                             break;
//                         }
//                     }
//                     if(idx == len) {
//                         // not already in cart
//                         cart.items.push(item);
//                     } else {
//                         cart.items[idx] = item;
//                     }
//                     cart.total = calcTotal(cart.items);
//                     // work out tax
//                     cart.tax = calcTax(cart.total);

//                     // save the updated cart
//                     saveCart(req.params.id, cart).then((data) => {
//                         res.json(cart);
//                     }).catch((err) => {
//                         req.log.error(err);
//                         res.status(500).send(err);
//                     });
//                 }
//             }
//         });
//     }
// });

// function mergeList(list, product, qty) {
//     var inlist = false;
//     // loop through looking for sku
//     var idx;
//     var len = list.length;
//     for(idx = 0; idx < len; idx++) {
//         if(list[idx].sku == product.sku) {
//             inlist = true;
//             break;
//         }
//     }

//     if(inlist) {
//         list[idx].qty += qty;
//         list[idx].subtotal = list[idx].price * list[idx].qty;
//     } else {
//         list.push(product);
//     }

//     return list;
// }

// function calcTotal(list) {
//     var total = 0;
//     for(var idx = 0, len = list.length; idx < len; idx++) {
//         total += list[idx].subtotal;
//     }

//     return total;
// }

// function calcTax(total) {
//     // tax @ 20%
//     return (total - (total / 1.2));
// }

// function getProduct(sku) {
//     return new Promise((resolve, reject) => {
//         request('http://' + catalogueHost + ':' + cataloguePort +'/product/' + sku, (err, res, body) => {
//             if(err) {
//                 reject(err);
//             } else if(res.statusCode != 200) {
//                 resolve(null);
//             } else {
//                 // return object - body is a string
//                 // TODO - catch parse error
//                 resolve(JSON.parse(body));
//             }
//         });
//     });
// }

// function saveCart(id, cart) {
//     logger.info('saving cart', cart);
//     return new Promise((resolve, reject) => {
//         redisClient.setex(id, 3600, JSON.stringify(cart), (err, data) => {
//             if(err) {
//                 reject(err);
//             } else {
//                 resolve(data);
//             }
//         });
//     });
// }

// // connect to Redis
// var redisClient = redis.createClient({
//     host: redisHost
// });

// redisClient.on('error', (e) => {
//     logger.error('Redis ERROR', e);
// });
// redisClient.on('ready', (r) => {
//     logger.info('Redis READY', r);
//     redisConnected = true;
// });

// // fire it up!
// const port = process.env.CART_SERVER_PORT || '8080';
// app.listen(port, () => {
//     logger.info('Started on port', port);
// });
const instana = require('@instana/collector');
// init tracing
// MUST be done before loading anything else!
instana({
    tracing: {
        enabled: true
    }
});

const redis = require('redis');
const request = require('request');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');
const promClient = require('prom-client');

const Registry = promClient.Registry;
const register = new Registry();
const counter = new promClient.Counter({
    name: 'items_added',
    help: 'running count of items added to cart',
    registers: [register]
});

var redisConnected = false;
var redisHost = process.env.REDIS_HOST || 'redis';
var catalogueHost = process.env.CATALOGUE_HOST || 'catalogue';
var cataloguePort = process.env.CATALOGUE_PORT || '8080';

const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});
const expLogger = expPino({
    logger: logger
});

const app = express();
app.use(expLogger);
app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
    const stat = {
        app: 'OK',
        redis: redisConnected
    };
    res.json(stat);
});

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(register.metrics());
});

// Get all items in cart
app.get('/cart/:id/items', (req, res) => {
    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            return res.status(500).send(err);
        }
        if (!data) {
            return res.status(404).send('Cart not found');
        }
        const cart = JSON.parse(data);
        res.json(cart.items);
    });
});

// Get cart by ID
app.get('/cart/:id', (req, res) => {
    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            return res.status(500).send(err);
        }
        if (!data) {
            return res.status(404).send('Cart not found');
        }
        res.json(JSON.parse(data));
    });
});

// Delete cart by ID
app.delete('/cart/:id', (req, res) => {
    redisClient.del(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            return res.status(500).send(err);
        }
        if (data === 1) {
            res.send('OK');
        } else {
            res.status(404).send('Cart not found');
        }
    });
});

// Rename cart
app.get('/rename/:from/:to', (req, res) => {
    redisClient.get(req.params.from, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            return res.status(500).send(err);
        }
        if (!data) {
            return res.status(404).send('Cart not found');
        }
        const cart = JSON.parse(data);
        saveCart(req.params.to, cart).then(() => {
            res.json(cart);
        }).catch((err) => {
            req.log.error(err);
            res.status(500).send(err);
        });
    });
});

// Update or create cart
app.get('/add/:id/:sku/:qty', (req, res) => {
    const qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 1) {
        req.log.warn('Invalid quantity');
        return res.status(400).send('Quantity must be a positive number');
    }

    getProduct(req.params.sku).then((product) => {
        req.log.info('Got product', product);
        if (!product) {
            return res.status(404).send('Product not found');
        }
        if (product.instock === 0) {
            return res.status(404).send('Out of stock');
        }

        redisClient.get(req.params.id, (err, data) => {
            if (err) {
                req.log.error('ERROR', err);
                return res.status(500).send(err);
            }

            const cart = data ? JSON.parse(data) : { total: 0, tax: 0, items: [] };
            const item = {
                qty: qty,
                sku: req.params.sku,
                name: product.name,
                price: product.price,
                subtotal: qty * product.price
            };
            cart.items = mergeList(cart.items, item, qty);
            cart.total = calcTotal(cart.items);
            cart.tax = calcTax(cart.total);

            saveCart(req.params.id, cart).then(() => {
                counter.inc(qty);
                res.json(cart);
            }).catch((err) => {
                req.log.error(err);
                res.status(500).send(err);
            });
        });
    }).catch((err) => {
        req.log.error(err);
        res.status(500).send(err);
    });
});

// Update quantity
app.get('/update/:id/:sku/:qty', (req, res) => {
    const qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 0) {
        req.log.warn('Invalid quantity');
        return res.status(400).send('Quantity must be a non-negative number');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            return res.status(500).send(err);
        }
        if (!data) {
            return res.status(404).send('Cart not found');
        }
        const cart = JSON.parse(data);
        const idx = cart.items.findIndex(item => item.sku === req.params.sku);
        if (idx === -1) {
            return res.status(404).send('Item not in cart');
        }

        if (qty === 0) {
            cart.items.splice(idx, 1);
        } else {
            cart.items[idx].qty = qty;
            cart.items[idx].subtotal = cart.items[idx].price * qty;
        }
        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        saveCart(req.params.id, cart).then(() => {
            res.json(cart);
        }).catch((err) => {
            req.log.error(err);
            res.status(500).send(err);
        });
    });
});

// Add shipping
app.post('/shipping/:id', (req, res) => {
    const shipping = req.body;
    if (!shipping.distance || !shipping.cost || !shipping.location) {
        req.log.warn('Shipping data missing', shipping);
        return res.status(400).send('Shipping data missing');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            return res.status(500).send(err);
        }
        if (!data) {
            req.log.info('No cart for', req.params.id);
            return res.status(404).send('Cart not found');
        }
        const cart = JSON.parse(data);
        const item = {
            qty: 1,
            sku: 'SHIP',
            name: 'Shipping to ' + shipping.location,
            price: shipping.cost,
            subtotal: shipping.cost
        };

        const idx = cart.items.findIndex(i => i.sku === item.sku);
        if (idx === -1) {
            cart.items.push(item);
        } else {
            cart.items[idx] = item;
        }
        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        saveCart(req.params.id, cart).then(() => {
            res.json(cart);
        }).catch((err) => {
            req.log.error(err);
            res.status(500).send(err);
        });
    });
});

// Helper functions
function mergeList(list, product, qty) {
    const idx = list.findIndex(item => item.sku === product.sku);
    if (idx !== -1) {
        list[idx].qty += qty;
        list[idx].subtotal = list[idx].price * list[idx].qty;
    } else {
        list.push(product);
    }
    return list;
}

function calcTotal(list) {
    return list.reduce((total, item) => total + item.subtotal, 0);
}

function calcTax(total) {
    return (total - (total / 1.2)); // tax @ 20%
}

function getProduct(sku) {
    return new Promise((resolve, reject) => {
        request(`http://${catalogueHost}:${cataloguePort}/product/${sku}`, (err, res, body) => {
            if (err) {
                reject(err);
            } else if (res.statusCode !== 200) {
                resolve(null);
            } else {
                resolve(JSON.parse(body));
            }
        });
    });
}

function saveCart(id, cart) {
    return new Promise((resolve, reject) => {
        redisClient.set(id, JSON.stringify(cart), (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// Redis connection
const redisClient = redis.createClient({
    host: redisHost
});
redisClient.on('connect', () => {
    redisConnected = true;
    logger.info('Connected to Redis');
});
redisClient.on('error', (err) => {
    logger.error('Redis error', err);
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
});



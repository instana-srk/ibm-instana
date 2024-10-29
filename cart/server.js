const instanaAvailable = process.env.INSTANA_AGENT_AVAILABLE === 'true';
let instana;
if (instanaAvailable) {
    instana = require('@instana/collector')({
        agentHost: process.env.INSTANA_AGENT_HOST || 'localhost',
        tracing: { enabled: true }
    });
    console.log("Instana initialized.");
} else {
    console.log("Instana not initialized as agent is unavailable.");
}

const redis = require('redis');
const request = require('request');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');
// Prometheus
const promClient = require('prom-client');
const Registry = promClient.Registry;
const register = new Registry();
const counter = new promClient.Counter({
    name: 'items_added',
    help: 'running count of items added to cart',
    registers: [register]
});

// Define redisHost before initializing redisClient
var redisHost = process.env.REDIS_HOST || 'redis';
const redisClient = redis.createClient({
    url: `redis://${redisHost}:6379`
});

var redisConnected = false;
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

app.get('/health', (req, res) => {
    var stat = {
        app: 'OK',
        redis: redisConnected
    };
    res.json(stat);
});

// Prometheus
app.get('/metrics', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(register.metrics());
});

// get cart with id
app.get('/cart/:id', (req, res) => {
    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                res.set('Content-Type', 'application/json');
                res.send(data);
            }
        }
    });
});

// delete cart with id
app.delete('/cart/:id', (req, res) => {
    redisClient.del(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == 1) {
                res.send('OK');
            } else {
                res.status(404).send('cart not found');
            }
        }
    });
});

// rename cart i.e. at login
app.get('/rename/:from/:to', (req, res) => {
    redisClient.get(req.params.from, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                var cart = JSON.parse(data);
                saveCart(req.params.to, cart).then((data) => {
                    res.json(cart);
                }).catch((err) => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
            }
        }
    });
});

// update/create cart
app.get('/add/:id/:sku/:qty', (req, res) => {
    // check quantity
    var qty = parseInt(req.params.qty);
    if (isNaN(qty)) {
        req.log.warn('quantity not a number');
        res.status(400).send('quantity must be a number');
        return;
    } else if (qty < 1) {
        req.log.warn('quantity less than one');
        res.status(400).send('quantity has to be greater than zero');
        return;
    }

    // look up product details
    getProduct(req.params.sku).then((product) => {
        req.log.info('got product', product);
        if (!product) {
            res.status(404).send('product not found');
            return;
        }
        // is the product in stock?
        if (product.instock == 0) {
            res.status(404).send('out of stock');
            return;
        }
        // does the cart already exist?
        redisClient.get(req.params.id, (err, data) => {
            if (err) {
                req.log.error('ERROR', err);
                res.status(500).send(err);
            } else {
                var cart;
                if (data == null) {
                    // create new cart
                    cart = {
                        total: 0,
                        tax: 0,
                        items: []
                    };
                } else {
                    cart = JSON.parse(data);
                }
                req.log.info('got cart', cart);
                // add sku to cart
                var item = {
                    qty: qty,
                    sku: req.params.sku,
                    name: product.name,
                    price: product.price,
                    subtotal: qty * product.price
                };
                var list = mergeList(cart.items, item, qty);
                cart.items = list;
                cart.total = calcTotal(cart.items);
                // work out tax
                cart.tax = calcTax(cart.total);

                // save the new cart
                saveCart(req.params.id, cart).then((data) => {
                    counter.inc(qty);
                    res.json(cart);
                }).catch((err) => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
            }
        });
    }).catch((err) => {
        req.log.error(err);
        res.status(500).send(err);
    });
});

// update quantity - remove item when qty == 0
app.get('/update/:id/:sku/:qty', (req, res) => {
    // check quantity
    var qty = parseInt(req.params.qty);
    if (isNaN(qty)) {
        req.log.warn('quantity not a number');
        res.status(400).send('quantity must be a number');
        return;
    } else if (qty < 0) {
        req.log.warn('quantity less than zero');
        res.status(400).send('negative quantity not allowed');
        return;
    }

    // get the cart
    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                var cart = JSON.parse(data);
                var idx;
                var len = cart.items.length;
                for (idx = 0; idx < len; idx++) {
                    if (cart.items[idx].sku == req.params.sku) {
                        break;
                    }
                }
                if (idx == len) {
                    // not in list
                    res.status(404).send('not in cart');
                } else {
                    if (qty == 0) {
                        cart.items.splice(idx, 1);
                    } else {
                        cart.items[idx].qty = qty;
                        cart.items[idx].subtotal = cart.items[idx].price * qty;
                    }
                    cart.total = calcTotal(cart.items);
                    // work out tax
                    cart.tax = calcTax(cart.total);
                    saveCart(req.params.id, cart).then((data) => {
                        res.json(cart);
                    }).catch((err) => {
                        req.log.error(err);
                        res.status(500).send(err);
                    });
                }
            }
        }
    });
});

// add shipping
app.post('/shipping/:id', (req, res) => {
    var shipping = req.body;
    if (shipping.distance === undefined || shipping.cost === undefined || shipping.location == undefined) {
        req.log.warn('shipping data missing', shipping);
        res.status(400).send('shipping data missing');
    } else {
        // get the cart
        redisClient.get(req.params.id, (err, data) => {
            if (err) {
                req.log.error('ERROR', err);
                res.status(500).send(err);
            } else {
                if (data == null) {
                    req.log.info('no cart for', req.params.id);
                    res.status(404).send('cart not found');
                } else {
                    var cart = JSON.parse(data);
                    var item = {
                        qty: 1,
                        sku: 'SHIP',
                        name: 'shipping to ' + shipping.location,
                        price: shipping.cost,
                        subtotal: shipping.cost
                    };
                    // check shipping already in the cart
                    var idx;
                    var len = cart.items.length;
                    for (idx = 0; idx < len; idx++) {
                        if (cart.items[idx].sku == item.sku) {
                            break;
                        }
                    }
                    if (idx == len) {
                        // not already in cart
                        cart.items.push(item);
                    } else {
                        cart.items[idx] = item;
                    }
                    cart.total = calcTotal(cart.items);
                    cart.tax = calcTax(cart.total);

                    saveCart(req.params.id, cart).then((data) => {
                        res.json(cart);
                    }).catch((err) => {
                        req.log.error(err);
                        res.status(500).send(err);
                    });
                }
            }
        });
    }
});

// merge if existing in list otherwise add to list
function mergeList(list, item, qty) {
    var idx;
    var len = list.length;
    for (idx = 0; idx < len; idx++) {
        if (list[idx].sku == item.sku) {
            list[idx].qty += qty;
            list[idx].subtotal += qty * item.price;
            return list;
        }
    }
    list.push(item);
    return list;
}

// save cart in redis
function saveCart(id, cart) {
    return redisClient.set(id, JSON.stringify(cart));
}

function getProduct(id) {
    return new Promise((resolve, reject) => {
        request.get(`http://${catalogueHost}:${cataloguePort}/product/${id}`, (err, resp, body) => {
            if (err) {
                reject(err);
            } else {
                resolve(JSON.parse(body));
            }
        });
    });
}

// cart total
function calcTotal(items) {
    var total = 0;
    for (var item of items) {
        total += item.subtotal;
    }
    return total;
}

// tax amount
function calcTax(total) {
    return total * 0.10;
}

// Establish Redis connection and start server
(async () => {
    try {
        await redisClient.connect();
        redisConnected = true;
        console.log("Redis connected.");
        app.listen(8080, () => {
            console.log("Cart service listening on port 8080.");
        });
    } catch (err) {
        console.error("Failed to connect to Redis:", err);
        process.exit(1);
    }
})();

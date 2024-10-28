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

app.use((req, res, next) => {
    let dcs = [
        "asia-northeast2",
        "asia-south1",
        "europe-west3",
        "us-east1",
        "us-west1"
    ];

    if (instana) {
        let span = instana.currentSpan();
        if (span) {
            span.annotate('custom.sdk.tags.datacenter', dcs[Math.floor(Math.random() * dcs.length)]);
        }
    }

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

// Get cart with id
app.get('/cart/:id', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

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

// Delete cart with id
app.delete('/cart/:id', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

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

// Rename cart
app.get('/rename/:from/:to', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    redisClient.get(req.params.from, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                var cart = JSON.parse(data);
                saveCart(req.params.to, cart).then(() => {
                    res.json(cart);
                }).catch((err) => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
            }
        }
    });
});

// Update/create cart
app.get('/add/:id/:sku/:qty', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

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

    getProduct(req.params.sku).then((product) => {
        req.log.info('got product', product);
        if (!product) {
            res.status(404).send('product not found');
            return;
        }

        if (product.instock === 0) {
            res.status(404).send('out of stock');
            return;
        }

        redisClient.get(req.params.id, (err, data) => {
            if (err) {
                req.log.error('ERROR', err);
                res.status(500).send(err);
            } else {
                var cart;
                if (data == null) {
                    cart = {
                        total: 0,
                        tax: 0,
                        items: []
                    };
                } else {
                    cart = JSON.parse(data);
                }

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
                cart.tax = calcTax(cart.total);

                saveCart(req.params.id, cart).then(() => {
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

// Update quantity
app.get('/update/:id/:sku/:qty', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

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

    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                var cart = JSON.parse(data);
                var idx = cart.items.findIndex(item => item.sku === req.params.sku);
                if (idx === -1) {
                    res.status(404).send('not in cart');
                } else {
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
                }
            }
        }
    });
});

// Add shipping
app.post('/shipping/:id', (req, res) => {
    if (!redisConnected) {
        return res.status(500).send('Redis is not connected');
    }

    var shipping = req.body;
    if (shipping.distance === undefined || shipping.cost === undefined || shipping.location === undefined) {
        req.log.warn('shipping data missing', shipping);
        res.status(400).send('missing shipping data');
        return;
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                var cart = JSON.parse(data);
                if (cart.shipping === undefined) {
                    cart.shipping = shipping;
                } else {
                    cart.shipping.cost += shipping.cost;
                    cart.shipping.distance += shipping.distance;
                }
                cart.total += cart.shipping.cost;
                saveCart(req.params.id, cart).then(() => {
                    res.json(cart);
                }).catch((err) => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
            }
        }
    });
});

// Merge list helper
function mergeList(list, item, qty) {
    var idx = list.findIndex(existingItem => existingItem.sku === item.sku);
    if (idx !== -1) {
        list[idx].qty += qty;
        list[idx].subtotal = list[idx].qty * list[idx].price;
    } else {
        list.push(item);
    }
    return list;
}

// Calculate total
function calcTotal(items) {
    return items.reduce((acc, item) => acc + item.subtotal, 0);
}

// Calculate tax
function calcTax(total) {
    return total * 0.1; // Example tax calculation (10%)
}

// Get product from catalogue
function getProduct(sku) {
    return new Promise((resolve, reject) => {
        request.get(`http://${catalogueHost}:${cataloguePort}/catalogue/${sku}`, (err, response, body) => {
            if (err) {
                reject(err);
            } else {
                resolve(JSON.parse(body));
            }
        });
    });
}

// Save cart to Redis
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

// Connect to Redis
const redisClient = redis.createClient({
    host: redisHost,
    port: 6379
});
redisClient.on('error', (err) => {
    console.error('Redis error:', err);
});
redisClient.on('connect', () => {
    console.log('Connected to Redis');
    redisConnected = true;
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

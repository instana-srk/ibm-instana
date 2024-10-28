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

let redisClient;

const redisHost = process.env.REDIS_HOST || 'redis';
const catalogueHost = process.env.CATALOGUE_HOST || 'catalogue';
const cataloguePort = process.env.CATALOGUE_PORT || '8080';

const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});
const expLogger = expPino({ logger });

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
        redis: redisClient && redisClient.connected
    };
    res.json(stat);
});

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(register.metrics());
});

// Get cart with ID
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

// Delete cart with ID
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

// Rename cart
app.get('/rename/:from/:to', (req, res) => {
    redisClient.get(req.params.from, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                const cart = JSON.parse(data);
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
    const qty = parseInt(req.params.qty);
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
                let cart;
                if (data == null) {
                    cart = {
                        total: 0,
                        items: []
                    };
                } else {
                    cart = JSON.parse(data);
                }

                // Update cart logic here...

                // Save the updated cart
                redisClient.set(req.params.id, JSON.stringify(cart), (err) => {
                    if (err) {
                        req.log.error('ERROR saving cart', err);
                        res.status(500).send(err);
                    } else {
                        counter.inc(qty); // Increment the counter for added items
                        res.send(cart);
                    }
                });
            }
        });
    }).catch((err) => {
        req.log.error(err);
        res.status(500).send(err);
    });
});

// Initialize Redis client and connect
function initRedis() {
    redisClient = redis.createClient({
        url: `redis://${redisHost}`
    });

    redisClient.on('connect', () => {
        logger.info('Connected to Redis');
    });

    redisClient.on('error', (err) => {
        logger.error('Redis Client Error', err);
    });

    redisClient.connect().catch((err) => {
        logger.error('Failed to connect to Redis', err);
    });
}

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    initRedis();
});

require('dotenv').config(); // Load environment variables

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

const { MongoClient, ObjectId } = require('mongodb');
const { createClient } = require('redis');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');
const cors = require('cors'); // Import CORS middleware

const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});

const expLogger = expPino({ logger });

const app = express();
app.use(expLogger);
app.use(cors()); // Use CORS middleware

// Middleware for body parsing
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// MongoDB
let db;
let usersCollection;
let ordersCollection;
let mongoConnected = false;

async function mongoConnect() {
    try {
        const mongoURL = process.env.MONGO_URL || 'mongodb://localhost:27017/users';
        const client = await MongoClient.connect(mongoURL);
        db = client.db('users');
        usersCollection = db.collection('users');
        ordersCollection = db.collection('orders');
        mongoConnected = true;
        logger.info('MongoDB connected');
    } catch (e) {
        logger.error('MongoDB connection ERROR', e);
        mongoConnected = false;
    }
}

// Redis connection
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisClient = createClient({
    url: `redis://${redisHost}:6379`
});

redisClient.on('error', (e) => logger.error('Redis ERROR', e));
redisClient.on('connect', () => logger.info('Redis connected'));
redisClient.connect();

// Health check endpoint
app.get('/health', async (req, res) => {
    const redisStatus = await redisClient.ping().then(() => 'connected').catch(() => 'not connected');
    const stat = {
        app: 'OK',
        mongo: mongoConnected,
        redis: redisStatus
    };
    res.json(stat);
});

// Unique ID endpoint using Redis
app.get('/uniqueid', async (req, res) => {
    try {
        const r = await redisClient.incr('anonymous-counter');
        res.json({ uuid: 'anonymous-' + r });
    } catch (err) {
        req.log.error('ERROR', err);
        res.status(500).send(err);
    }
});

// Middleware for checking MongoDB connection
function checkMongoConnection(req, res, next) {
    if (mongoConnected) {
        next();
    } else {
        req.log.error('Database not available');
        res.status(500).send('Database not available');
    }
}

// Check if user exists
app.get('/check/:id', checkMongoConnection, async (req, res) => {
    try {
        const user = await usersCollection.findOne({ name: req.params.id });
        user ? res.send('OK') : res.status(404).send('User not found');
    } catch (e) {
        req.log.error(e);
        res.status(500).send(e);
    }
});

// Return all users for debugging
app.get('/users', checkMongoConnection, async (req, res) => {
    try {
        const users = await usersCollection.find().toArray();
        res.json(users);
    } catch (e) {
        req.log.error('ERROR', e);
        res.status(500).send(e);
    }
});

// User login
app.post('/login', checkMongoConnection, async (req, res) => {
    req.log.info('login', req.body);
    if (!req.body.name || !req.body.password) {
        req.log.warn('Credentials not complete');
        return res.status(400).send('Name or password not supplied');
    }

    try {
        const user = await usersCollection.findOne({ name: req.body.name });
        req.log.info('user', user);
        if (user) {
            user.password === req.body.password ? res.json(user) : res.status(404).send('Incorrect password');
        } else {
            res.status(404).send('Name not found');
        }
    } catch (e) {
        req.log.error('ERROR', e);
        res.status(500).send(e);
    }
});

// User registration
app.post('/register', checkMongoConnection, async (req, res) => {
    req.log.info('register', req.body);
    if (!req.body.name || !req.body.password || !req.body.email) {
        req.log.warn('Insufficient data');
        return res.status(400).send('Insufficient data');
    }

    try {
        const user = await usersCollection.findOne({ name: req.body.name });
        if (user) {
            req.log.warn('User already exists');
            res.status(400).send('Name already exists');
        } else {
            await usersCollection.insertOne({
                name: req.body.name,
                password: req.body.password,
                email: req.body.email
            });
            res.send('OK');
        }
    } catch (e) {
        req.log.error('ERROR', e);
        res.status(500).send(e);
    }
});

// Place an order
app.post('/order/:id', checkMongoConnection, async (req, res) => {
    req.log.info('order', req.body);
    try {
        const user = await usersCollection.findOne({ name: req.params.id });
        if (user) {
            const history = await ordersCollection.findOne({ name: req.params.id });
            const orderData = { ...req.body };

            if (history) {
                const list = history.history;
                list.push(orderData);
                await ordersCollection.updateOne(
                    { name: req.params.id },
                    { $set: { history: list } }
                );
            } else {
                await ordersCollection.insertOne({
                    name: req.params.id,
                    history: [orderData]
                });
            }
            res.send('OK');
        } else {
            res.status(404).send('Name not found');
        }
    } catch (e) {
        req.log.error(e);
        res.status(500).send(e);
    }
});

// Get order history
app.get('/history/:id', checkMongoConnection, async (req, res) => {
    try {
        const history = await ordersCollection.findOne({ name: req.params.id });
        history ? res.json(history) : res.status(404).send('History not found');
    } catch (e) {
        req.log.error(e);
        res.status(500).send(e);
    }
});

// Connect to MongoDB
mongoConnect();

// Start the server
const port = process.env.PORT || 8080;
app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
});

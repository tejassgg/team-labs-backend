const swaggerJsdoc = require('swagger-jsdoc');
require('dotenv').config();

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TeamLabs API Documentation',
      version: '1.0.0',
      description: 'API documentation for TeamLabs application',
      contact: {
        name: 'TeamLabs Support',
        email: 'support@teamlabs.com'
      }
    },
    servers: [
      {
        url: process.env.API_URL,
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [{
      bearerAuth: []
    }]
  },
  apis: ['./routes/*.js', './controllers/*.js', './models/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = specs; 
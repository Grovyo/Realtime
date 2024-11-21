FROM node:20

WORKDIR /home/app

COPY package*.json .
COPY yarn.lock yarn.lock
COPY grovyo-89dc2-ff6415ff18de.json grovyo-89dc2-ff6415ff18de.json
COPY models models
COPY index.js index.js

RUN npm install
EXPOSE 4400

ENTRYPOINT [ "npm","start" ]
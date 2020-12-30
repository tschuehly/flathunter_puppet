FROM buildkite/puppeteer

COPY package.json /flathunter/
WORKDIR flathunter
RUN npm i

COPY dist/flathunter.js /flathunter/
COPY immo.db /flathunter/
CMD ["npm","run","docker-start"]

FROM buildkite/puppeteer

COPY package.json /flathunter/
WORKDIR flathunter
RUN npm i

COPY dist/flathunter.js /flathunter/
COPY config /flathunter/config
RUN mkdir /flathunter/err/
CMD ["npm","run","docker-start"]

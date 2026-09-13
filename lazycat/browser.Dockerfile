# LPK uses the same pinned headless engine as docker/browser.mjs.
FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /browser
RUN npm install --omit=dev playwright@1.58.2 \
    && npx playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm
COPY docker/browser.mjs ./browser.mjs
USER node
CMD ["node", "browser.mjs"]

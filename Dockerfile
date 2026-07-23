FROM nginx:alpine

COPY public/index.html public/styles.css public/portal.js /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

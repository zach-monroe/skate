FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11-utils x11-xserver-utils \
    openbox \
    x11vnc \
    novnc websockify \
    xdotool \
    imagemagick scrot \
    firefox-esr \
    dbus-x11 \
    fonts-liberation \
    ca-certificates \
    procps \
  && rm -rf /var/lib/apt/lists/*

# ImageMagick's default policy disallows reading X displays; the desktop
# stream depends on `import -window root`, so relax that one restriction.
RUN sed -i '/rights="none" pattern="X"/d' /etc/ImageMagick-6/policy.xml || true

RUN useradd -m -s /bin/bash surf

ENV DISPLAY=:1
ENV HOME=/home/surf

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && chown surf:surf /usr/local/bin/entrypoint.sh

USER surf
WORKDIR /home/surf

EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

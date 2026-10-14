# The Photo Maps API. Build from this directory:
#
#   docker build -t photo-maps-backend .
#   docker run -p 8080:8080 --env-file ../.env.local photo-maps-backend
#
# Ubuntu 24.04 because the HEIC decoder needs libheif >= 1.17.

FROM ubuntu:24.04 AS build
ARG RUST_VERSION=1.97.0
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential ca-certificates cmake curl nasm pkg-config libheif-dev liblcms2-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain "${RUST_VERSION}"
ENV PATH=/root/.cargo/bin:$PATH
WORKDIR /src
COPY . .
RUN cargo build --release --locked && cp target/release/photo-maps-backend /usr/local/bin/

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
# libheif's HEVC (HEIC) and AV1 (AVIF) decoders ship as separate plugin packages.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates libheif1 libheif-plugin-libde265 libheif-plugin-dav1d liblcms2-2 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home photomaps
COPY --from=build /usr/local/bin/photo-maps-backend /usr/local/bin/photo-maps-backend
USER photomaps
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["photo-maps-backend"]
CMD ["serve"]

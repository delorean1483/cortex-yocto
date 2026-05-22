FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    gawk \
    wget \
    git \
    diffstat \
    unzip \
    texinfo \
    gcc \
    build-essential \
    chrpath \
    socat \
    cpio \
    python3 \
    python3-pip \
    python3-pexpect \
    python3-git \
    python3-jinja2 \
    python3-subunit \
    xz-utils \
    debianutils \
    iputils-ping \
    libegl1-mesa-dev \
    libsdl1.2-dev \
    pylint \
    xterm \
    rsync \
    curl \
    zstd \
    file \
    locales \
    sudo \
    vim \
    tmux \
    nano \
    tar \
    gzip \
    bzip2 \
    lz4 \
    zstd \
    unzip \
    zip \
    ca-certificates

RUN locale-gen en_US.UTF-8

RUN pip3 install --no-cache-dir kas

ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

WORKDIR /work

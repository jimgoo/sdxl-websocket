# SDXL - Websocket

https://jgoode.s3.amazonaws.com/sdxl-websocket/sdxl-websocket-demo-4x.mp4

## Backend

### Install
```
conda env create -f environment.yaml -n sdxl-websocket
conda activate sdxl-websocket
```

### Run
```
uvicorn backend:app --host 0.0.0.0 --port 50217 --reload
```

## Frontend

### Install
```
npm install
```

### Run
```
npm start
```
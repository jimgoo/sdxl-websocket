import React, { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Card,
  Grid,
  ImageList,
  ImageListItem,
  LinearProgress,
  Modal,
  Snackbar,
  TextField,
} from '@mui/material';
import * as msgpack from '@msgpack/msgpack';

const SDXLComponent = () => {
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [textRows, setTextRows] = useState(1);
  const [progress, setProgress] = useState(0);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);

  const BACKEND_URL = `ws://localhost:50217/images/generate-ws`;

  const sizes = [[1024, 1024], [1536, 640]];
  const width = sizes[0][0];
  const height = sizes[0][1];
  const useBinary = true;

  useEffect(() => {
    // Calculate the number of rows needed in the prompt text field
    const numOfRows = prompt.length / 50;
    setTextRows(numOfRows);
  }, [prompt]);

  const generateImages = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setProgress(0);

    const startTime = Date.now();
    const steps = 40;

    const payload = {
      use_binary: useBinary,
      engine: 'stable-diffusion-xl-1024-v1-0',
      steps: steps,
      width: width,
      height: height,
      seed: Math.floor(Math.random() * 10000),
      cfg_scale: 5,
      samples: 4,
      text_prompts: [
        {
          // positive prompt
          text: prompt,
          weight: 1,
        },
        {
          // negative prompt
          text: 'blurry',
          weight: -1,
        },
      ],
      callback_steps: 5, // Number of steps between each callback that sends progress images
      callback_start: 0, // Step to start sending progress images
    };

    console.log(`generateImages | payload ${JSON.stringify(payload, null, 2)}`);

    try {
      // Connect to WebSocket API
      const ws = new WebSocket(BACKEND_URL);

      ws.onopen = (event) => {
        console.log('ws.onopen');
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = async (event) => {
        if (useBinary) {
          // Use MessagePack
          if (event.data instanceof Blob) {
            const blob = event.data;
            const arrayBuffer = await blob.arrayBuffer();
            const update = msgpack.decode(new Uint8Array(arrayBuffer));

            // Now update should be an object containing status, step, and artifacts
            if (update.status) {
              console.log(`ws.onmessage: status ${update.status}`);
            }
            if (update.step) {
              console.log(`ws.onmessage: step ${update.step}`);
              setProgress(Math.min((100 * update.step) / (steps - 1), 100));

              if (update.step === steps - 1) {
                setIsLoading(false);
                const endTime = Date.now(); // Record the end time
                const timeTaken = ((endTime - startTime) / 1000).toFixed(2); // Time taken in seconds
                console.log(`Time taken for API call: ${timeTaken} seconds`);
                ws.close(); // Close the WebSocket connection
              }
            }
            if (update.artifacts) {
              console.log(`ws.onmessage: setting images`);

              const newImages = []; // Array to hold new base64 images

              // Convert each artifact (blob data) to a base64 string
              const convertArtifactToBase64 = (artifact, index, arr) => {
                return new Promise((resolve, reject) => {
                  const blob = new Blob([artifact], { type: 'image/jpeg' });
                  const reader = new FileReader();

                  reader.onloadend = () => {
                    const base64data = reader.result;
                    newImages.push(base64data); // Add to newImages array
                    resolve();
                  };

                  reader.onerror = () => {
                    reject(new Error('Error reading blob as data URL.'));
                  };

                  reader.readAsDataURL(blob);
                });
              };
              // Wait for all conversions to complete
              Promise.all(update.artifacts.map(convertArtifactToBase64))
                .then(() => {
                  setImages(newImages);
                })
                .catch((error) => {
                  console.error('Failed to convert some artifacts to base64:', error);
                });
            }
          }
        } else {
          // Use JSON
          const update = JSON.parse(event.data);
          if (update.status) {
            console.log(`ws.onmessage: status ${update.status}`);
          }
          if (update.step) {
            console.log(`ws.onmessage: step ${update.step}`);
            setProgress(Math.min((100 * update.step) / (steps - 1), 100));

            if (update.step === steps - 1) {
              setIsLoading(false);
              const endTime = Date.now(); // Record the end time
              const timeTaken = ((endTime - startTime) / 1000).toFixed(2); // Time taken in seconds
              console.log(`Time taken for API call: ${timeTaken} seconds`);
              ws.close(); // Close the WebSocket connection
            }
          }
          if (update.artifacts) {
            console.log(`ws.onmessage: setting images`);
            const base64Images = update.artifacts.map(
              (imgData) => `data:image/jpeg;base64,${imgData.base64}`,
            );
            setImages(base64Images);
          }
        }
      };

      ws.onclose = (event) => {
        if (event.wasClean) {
          console.log(`Closed cleanly, code=${event.code}, reason=${event.reason}`);
        } else {
          console.error(`Connection died`);
        }
      };

      ws.onerror = (error) => {
        console.error(`ws.onerror: ${error.message}`, error);
        ws.close(); // Close the WebSocket connection
        setProgress(0);
        setAlertMessage(`An error occurred in the WebSocket: ${error.message}`);
        setAlertOpen(true);
        setIsLoading(false);
      };
    } catch (error) {
      console.error('Error generating image:', error, ', response:', error.response);
      setProgress(0);
      setAlertMessage(
        `An error occurred while generating the image: ${error.response?.data?.message}`,
      );
      setAlertOpen(true);
      setIsLoading(false);
    }
  };

  const openModal = (imageSrc) => {
    setCurrentImage(imageSrc);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  return (
    <Container style={{ padding: '20px' }}>
      <form onSubmit={generateImages}>
        <Grid container spacing={3} alignItems="center" paddingBottom="10px">
          <Grid item xs={9}>
            <TextField
              label="Your SDXL prompt"
              variant="outlined"
              fullWidth
              multiline // Allows multiple lines of text
              rows={textRows} // Initially shows this many rows
              rowsmax={10} // Maximum rows that can be visible
              autoComplete="on"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Grid>
          <Grid item xs={3}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isLoading}
              fullWidth
            >
              {isLoading ? <CircularProgress size={24} /> : 'Generate'}
            </Button>
            <div style={{ height: '10px' }} />
            {isLoading && <LinearProgress variant="determinate" value={progress} />}
          </Grid>
        </Grid>
      </form>
      {images.length > 0 && (
        <Card>
          <ImageList cols={2} gap={10}>
            {images.map((img, index) => (
              <ImageListItem key={index} onClick={() => openModal(img)}>
                <img src={img} alt={`Generated Content ${index}`} />
              </ImageListItem>
            ))}
          </ImageList>
        </Card>
      )}
      <Modal open={isModalOpen} onClose={closeModal}>
        <Box
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {currentImage && (
            <img
              src={currentImage}
              alt="Full Size"
              style={{ width: `${width}px`, height: `${height}px` }}
            />
          )}
        </Box>
      </Modal>
      <Snackbar
        open={alertOpen}
        autoHideDuration={6000}
        onClose={() => setAlertOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setAlertOpen(false)} severity="error">
          {alertMessage}
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default SDXLComponent;
import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Box,
  Dialog,
  TextField,
  Button,
  Card,
  CardContent,
  ImageList,
  ImageListItem,
  LinearProgress,
  Modal,
  Typography,
  CardMedia,
  CircularProgress,
  Grid,
  Container,
  Snackbar,
} from '@mui/material';
import axios from 'axios';
import * as msgpack from '@msgpack/msgpack';
// import { useUserToken } from '@/context/userContext';
import { examplePrompts } from './examplePrompts';

const SDXLComponent = () => {
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showExamples, setShowExamples] = useState(true);
  const [textRows, setTextRows] = useState(1);
  const [progress, setProgress] = useState(0);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [userImages, setUserImages] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isModalOpen, setModalOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);

  // const token = useUserToken(); // this is the user's fixed identity token not the JWT token
  const token = '';

  // const BACKEND_URL = 'http://localhost:8000';
  const BACKEND_BASE = 'localhost:50217';
  const BACKEND_URL = `http://${BACKEND_BASE}`;
  const BACKEND_URL_WS = `ws://${BACKEND_BASE}/images/generate-ws`;

  const IMAGE_GAP = 10;
  const JWT_STORAGE_KEY = 'cyh-jwtToken';
  const width = 1024;
  const height = 1024;
  // const width = 1536;
  // const height = 640;
  const useBinary = true;

  useEffect(() => {
    // Calculate the number of rows needed in the prompt text field
    const numOfRows = prompt.length / 50;
    setTextRows(numOfRows);
  }, [prompt]);

  const handleLogin = useCallback(async () => {
    try {
      console.log('handleLogin');
      if (!token) {
        return;
      }
      const response = await axios.post(
        BACKEND_URL + '/auth',
        { token: token },
        {
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
          },
        },
      );
      console.log(`handleLogin | response.data ${JSON.stringify(response.data, null, 2)}`);
      localStorage.setItem(JWT_STORAGE_KEY, response.data.access_token);
    } catch (error) {
      console.error('An error occurred during login:', error);
      setAlertMessage(`An error occurred while authenticating with the server: ${error}`);
      setAlertOpen(true);
    }
  }, [token]);

  const getHeaders = () => {
    const jwtToken = localStorage.getItem(JWT_STORAGE_KEY);
    const headers = {
      'Content-Type': 'application/json;charset=UTF-8',
      Authorization: 'Bearer ' + jwtToken,
    };
    return headers;
  };

  const getImagesList = useCallback(async () => {
    const url = BACKEND_URL + '/images/list';
    const headers = getHeaders();
    console.log(`getImagesList: headers ${JSON.stringify(headers, null, 2)}`);
    try {
      const response = await axios.get(url, { headers });
      console.log(`getImagesList | response.data ${JSON.stringify(response.data, null, 2)}`);
      setUserImages(response.data.images);
    } catch (error) {
      console.log(`Failed to get images list: `, error);
      setAlertMessage(`An error occurred while fetching your images: ${error}`);
      setAlertOpen(true);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      await handleLogin();
      await getImagesList();
    };
    initialize();
  }, [token]);

  const toggleExamples = () => {
    setShowExamples(!showExamples); // Toggle example visibility
  };

  const generateImages = async (event) => {
    event.preventDefault(); // Prevent default form submission
    setIsLoading(true);
    // setShowExamples(false);  // Hide examples when generating an image
    setProgress(0);

    const startTime = Date.now();
    const steps = 40;

    const payload = {
      engine: 'stable-diffusion-xl-1024-v1-0',
      steps: steps,
      width: width,
      height: height,
      seed: Math.floor(Math.random() * 10000),
      cfg_scale: 5,
      samples: 2,
      text_prompts: [
        {
          text: prompt,
          weight: 1,
        },
        {
          // "text": "blurry, bad",
          text: 'blurry',
          weight: -1,
        },
      ],
      // callback_steps: Math.max(Math.floor(steps / 4), 1),
      callback_steps: 5,
      callback_start: 25,
    };

    console.log(`generateImages | payload ${JSON.stringify(payload, null, 2)}`);

    try {
      const url = BACKEND_URL_WS;

      // Connect to WebSocket API
      const ws = new WebSocket(url);

      ws.onopen = (event) => {
        console.log('ws.onopen');
        // TODO: send the auth info here and verify on the other end
        ws.send(JSON.stringify(payload));
      };

      ws.onmessage = async (event) => {
        if (useBinary) {
          // Use MessagePack
          if (event.data instanceof Blob) {
            const blob = event.data;
            const arrayBuffer = await blob.arrayBuffer();
            const update = msgpack.decode(new Uint8Array(arrayBuffer));
            // console.log(`ws.onmessage: update ${JSON.stringify(update, null, 2)}`);

            // Now update should be an object containing status, step, and artifacts
            if (update.status) {
              console.log(`ws.onmessage: status ${update.status}`);
            }
            if (update.step) {
              console.log(`ws.onmessage: step ${update.step}`);
              setProgress(Math.min((100 * update.step) / (steps - 1), 100));
              setCurrentStep(update.step);

              if (update.step === steps - 1) {
                setIsLoading(false);
                const endTime = Date.now(); // Record the end time
                const timeTaken = ((endTime - startTime) / 1000).toFixed(2); // Time taken in seconds
                console.log(`Time taken for API call: ${timeTaken} seconds`);
                ws.close(); // Close the WebSocket connection
              }
            }
            if (update.artifacts) {
              console.log(`onmessage: setting images`);

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
            setCurrentStep(update.step);

            if (update.step === steps - 1) {
              setIsLoading(false);
              const endTime = Date.now(); // Record the end time
              const timeTaken = ((endTime - startTime) / 1000).toFixed(2); // Time taken in seconds
              console.log(`Time taken for API call: ${timeTaken} seconds`);
              ws.close(); // Close the WebSocket connection
            }
          }
          if (update.artifacts) {
            console.log(`onmessage: setting images`);
            // <TODO> use jpeg instead of png
            const base64Images = update.artifacts.map(
              (imgData) => `data:image/png;base64,${imgData.base64}`,
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

      // getImagesList(); // refetch the user's images
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
              label="Describe what you saw during your experience, being as visually descriptive as possible."
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
            {/* <div style={{ height: '10px' }} />
            <Button 
              onClick={toggleExamples}
              variant="contained"
              color="secondary"
              fullWidth
            >
              {showExamples ? `Hide Examples` : `Show Examples`}
            </Button> */}
          </Grid>
        </Grid>
      </form>
      {images.length > 0 && (
        <Card>
          {/* <CardContent>
            <Typography variant="h5">Generations</Typography>
          </CardContent> */}
          <ImageList cols={2} gap={IMAGE_GAP}>
            {images.map((img, index) => (
              <ImageListItem key={index} onClick={() => openModal(img)}>
                <img src={img} alt={`Generated Content ${index}`} />
                {!isLoading && (
                  <Button
                    variant="contained"
                    color="primary"
                    // onClick={() => storeImage(img, index)}
                  >
                    Save
                  </Button>
                )}
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
      {showExamples && (
        <Box width={1} paddingTop="10px">
          <Card>
            <CardContent>
              <Typography variant="h5">Examples</Typography>
              <ul>
                {examplePrompts.map((example, index) => (
                  <li key={index}>
                    <Typography variant="h6">
                      {example.text}
                      <span style={{ fontStyle: 'italic' }}>
                        {example.source === 'customer' ? '' : `(Source: ${example.source})`}
                      </span>
                    </Typography>
                    <br></br>
                    <ImageList cols={2} gap={IMAGE_GAP}>
                      {example.images.map((imgURL, imgIndex) => (
                        <ImageListItem key={imgIndex} onClick={() => openModal(imgURL)}>
                          <img src={imgURL} alt={`Example Content ${imgIndex}`} />
                        </ImageListItem>
                      ))}
                    </ImageList>
                    <br></br>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </Box>
      )}
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
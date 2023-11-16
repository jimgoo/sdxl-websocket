import React from "react";
import { Container, CssBaseline } from "@mui/material";
import SDXLComponent from "./components/SDXLComponent";
import { BrowserRouter as Router } from 'react-router-dom';

function App() {
    return (
        <Router>
            <CssBaseline />
            <Container>
                <SDXLComponent />
            </Container>
        </Router>
    );
}

export default App;

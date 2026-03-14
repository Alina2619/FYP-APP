import React, { useState, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    ScrollView,
    Alert,
    Image,
    Modal,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator
} from 'react-native';
import Footer from '../Components/Footer';
import DateTimePicker from '@react-native-community/datetimepicker';
import RNPickerSelect from 'react-native-picker-select';
import * as ImagePicker from 'expo-image-picker';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';

const pickerStyle = {
    inputIOS: {
        fontSize: 16,
        paddingVertical: 12,
        paddingHorizontal: 10,
        borderWidth: 2,
        borderColor: '#ccc',
        borderRadius: 10,
        color: 'black',
        backgroundColor: '#f9f9f9',
    },
    inputAndroid: {
        fontSize: 16,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderWidth: 2,
        borderColor: '#ccc',
        borderRadius: 10,
        color: 'black',
        backgroundColor: '#f9f9f9',
    },
    placeholder: {
        color: '#888',
        fontSize: 16,
    },
};

const DriverSetup1 = ({ navigation }) => {
    const [step, setStep] = useState(1);

    // Step 1
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [cnic, setCnic] = useState('');
    const [dob, setDob] = useState(null);
    const [showDobPicker, setShowDobPicker] = useState(false);
    const [gender, setGender] = useState('');
    const [profileImage, setProfileImage] = useState(null);

    // Step 2
    const [vehicleType, setVehicleType] = useState('');
    const [vehicleBrand, setVehicleBrand] = useState('');
    const [vehicleNumber, setVehicleNumber] = useState('');

    // Step 3 - Barcode-based License Verification
    const [licenseNumber, setLicenseNumber] = useState('');
    const [expiryDate, setExpiryDate] = useState(null);
    const [showExpiryPicker, setShowExpiryPicker] = useState(false);
    const [issuingAuthority, setIssuingAuthority] = useState('');
    
    // Barcode Scanning States
    const [scanned, setScanned] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isBarcodeScanned, setIsBarcodeScanned] = useState(false);
    
    // Gallery Import States
    const [showImportOptions, setShowImportOptions] = useState(false);
    const [importingFromGallery, setImportingFromGallery] = useState(false);
    
    // Barcode Data States
    const [barcodeData, setBarcodeData] = useState(null);
    const [verificationResult, setVerificationResult] = useState(null);
    const [verificationDetails, setVerificationDetails] = useState([]);

    // Step 4 - Terms & Conditions
    const [agreed, setAgreed] = useState(false);
    const [showPrivacy, setShowPrivacy] = useState(false);
    const [showTerms, setShowTerms] = useState(false);

    // License Photo States
    const [frontLicenseImage, setFrontLicenseImage] = useState(null);
    const [backLicenseImage, setBackLicenseImage] = useState(null);
    const [isTakingLicensePhotos, setIsTakingLicensePhotos] = useState(false);
    const [licensePhotosUploaded, setLicensePhotosUploaded] = useState(false);

    // Upload States
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    // Camera ref and permissions
    const cameraRef = useRef(null);
    const [permission, requestPermission] = useCameraPermissions();

    const auth = getAuth();
    const db = getFirestore();

    const formatDate = (date) => {
        if (!date) return '';
        return new Intl.DateTimeFormat('en-GB').format(date);
    };

    // -----------------------------
    // Image Picker for Profile
    // -----------------------------
    const pickProfileImage = async () => {
        try {
            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 4],
                quality: 0.7,
            });
            if (!result.canceled) {
                setProfileImage(result.assets[0].uri);
            }
        } catch (error) {
            console.log("Profile image picker error:", error);
            Alert.alert("Error", "Failed to pick profile image. Please try again.");
        }
    };

    // -----------------------------
    // License Photo Capture Functions
    // -----------------------------
    const captureLicensePhotos = async () => {
        try {
            setIsTakingLicensePhotos(true);
            
            // Capture Front License Photo
            Alert.alert(
                "Front License Photo",
                "Please take a clear photo of the FRONT side of your driver's license",
                [
                    {
                        text: "Take Photo",
                        onPress: async () => {
                            try {
                                const frontResult = await ImagePicker.launchCameraAsync({
                                    mediaTypes: ImagePicker.MediaTypeOptions.Images,
                                    allowsEditing: true,
                                    aspect: [4, 3],
                                    quality: 0.7,
                                });
                                
                                if (!frontResult.canceled) {
                                    setFrontLicenseImage(frontResult.assets[0].uri);
                                    
                                    // After front photo, ask for back photo
                                    setTimeout(() => {
                                        Alert.alert(
                                            "Back License Photo",
                                            "Now please take a clear photo of the BACK side of your driver's license",
                                            [
                                                {
                                                    text: "Take Photo",
                                                    onPress: async () => {
                                                        try {
                                                            const backResult = await ImagePicker.launchCameraAsync({
                                                                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                                                                allowsEditing: true,
                                                                aspect: [4, 3],
                                                                quality: 0.7,
                                                            });
                                                            
                                                            if (!backResult.canceled) {
                                                                setBackLicenseImage(backResult.assets[0].uri);
                                                                setLicensePhotosUploaded(true);
                                                                Alert.alert(
                                                                    "✅ Photos Captured",
                                                                    "Both license photos have been captured successfully.",
                                                                    [{ text: "OK" }]
                                                                );
                                                            }
                                                        } catch (error) {
                                                            console.log("Back photo error:", error);
                                                            Alert.alert("Error", "Failed to capture back photo");
                                                        } finally {
                                                            setIsTakingLicensePhotos(false);
                                                        }
                                                    }
                                                },
                                                {
                                                    text: "Skip",
                                                    onPress: () => {
                                                        setIsTakingLicensePhotos(false);
                                                        Alert.alert("Info", "Back photo is required for verification");
                                                    }
                                                }
                                            ]
                                        );
                                    }, 500);
                                }
                            } catch (error) {
                                console.log("Front photo error:", error);
                                Alert.alert("Error", "Failed to capture front photo");
                                setIsTakingLicensePhotos(false);
                            }
                        }
                    },
                    {
                        text: "Cancel",
                        style: "cancel",
                        onPress: () => setIsTakingLicensePhotos(false)
                    }
                ]
            );
            
        } catch (error) {
            console.log("License photo capture error:", error);
            setIsTakingLicensePhotos(false);
            Alert.alert("Error", "Failed to capture license photos");
        }
    };

    const captureSinglePhoto = async (side) => {
        try {
            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.7,
            });
            
            if (!result.canceled) {
                if (side === 'front') {
                    setFrontLicenseImage(result.assets[0].uri);
                } else {
                    setBackLicenseImage(result.assets[0].uri);
                }
                
                // Check if both photos are captured
                if ((side === 'front' && backLicenseImage) || 
                    (side === 'back' && frontLicenseImage)) {
                    setLicensePhotosUploaded(true);
                }
            }
        } catch (error) {
            console.log(`${side} photo error:`, error);
            Alert.alert("Error", `Failed to capture ${side} photo`);
        }
    };

    // -----------------------------
    // Barcode Processing Function
    // -----------------------------
    const processBarcodeData = (barcodeData) => {
        try {
            console.log("Processing barcode data:", barcodeData);
            
            // Parse the barcode data
            const parsedData = parseBarcodeData(barcodeData);
            console.log("Parsed Data:", parsedData);
            
            if (!parsedData.licenseNumber) {
                Alert.alert(
                    "Invalid Barcode", 
                    "Could not read license information from barcode. Please ensure you're scanning a valid driver's license barcode.",
                    [{ text: "OK" }]
                );
                return false;
            }
            
            setBarcodeData(parsedData);
            setIsBarcodeScanned(true);
            setScanned(true);
            setIsScanning(false);
            
            // Auto-fill license number if found
            if (parsedData.licenseNumber) {
                setLicenseNumber(parsedData.licenseNumber);
            }
            
            // Show success message
            Alert.alert(
                "✅ Barcode Scanned Successfully",
                "License information has been extracted from barcode.",
                [
                    {
                        text: "OK",
                        onPress: () => {
                            setShowScanner(false);
                            setShowImportOptions(false);
                        }
                    }
                ]
            );
            
            return true;
            
        } catch (error) {
            console.log("Barcode processing error:", error);
            Alert.alert("Error", "Failed to process barcode data. Please try again.");
            return false;
        }
    };

    // Parse barcode data - Updated for Pakistani license format
    const parseBarcodeData = (data) => {
        try {
            console.log("Raw barcode data:", data);
            
            // If data is empty or null
            if (!data || typeof data !== 'string') {
                return { rawData: data || '' };
            }
            
            // Common formats for Pakistani licenses:
            // Format 1: CNIC,NAME,LICENSE_NUMBER
            // Example: "3730245557739,IMTIAZ AHMED MALIK,JM-20-477"
            if (data.includes(',')) {
                const parts = data.split(',');
                console.log("Split parts:", parts);
                
                if (parts.length >= 3) {
                    // Usually format is: CNIC, NAME, LICENSE_NUMBER
                    // Some licenses might also have expiry date as 4th part
                    return {
                        cnic: parts[0]?.trim() || '',
                        name: parts[1]?.trim() || '',
                        licenseNumber: parts[2]?.trim() || '',
                        expiry: parts[3]?.trim() || ''
                    };
                }
            }
            
            // Format 2: Pipe-delimited
            if (data.includes('|')) {
                const parts = data.split('|');
                if (parts.length >= 3) {
                    return {
                        cnic: parts[0]?.trim() || '',
                        name: parts[1]?.trim() || '',
                        licenseNumber: parts[2]?.trim() || '',
                        expiry: parts[3]?.trim() || ''
                    };
                }
            }
            
            // Format 3: Try to identify CNIC pattern
            const cnicMatch = data.match(/(\d{13}|\d{5}-\d{7}-\d{1})/);
            if (cnicMatch) {
                // Try to find license number pattern
                const licenseMatch = data.match(/([A-Z]{2,3}[-\s]?\d{1,4}[-\s]?\d{1,4}|[A-Z]{1,4}\d{3,10})/);
                const nameMatch = data.match(/([A-Z\s]{5,})/);
                
                return {
                    cnic: cnicMatch[0] || '',
                    name: nameMatch ? nameMatch[0].trim() : '',
                    licenseNumber: licenseMatch ? licenseMatch[0].trim() : '',
                    expiry: ''
                };
            }
            
            // If it's just a license number
            if (/^[A-Z]{1,4}[- ]?\d{1,10}/.test(data)) {
                return {
                    licenseNumber: data.trim(),
                    name: '',
                    cnic: '',
                    expiry: ''
                };
            }
            
            console.log("Could not parse barcode data, returning raw");
            return { 
                rawData: data,
                licenseNumber: data.trim(),
                name: '',
                cnic: '',
                expiry: ''
            };
            
        } catch (error) {
            console.log("Parse error:", error);
            return { 
                rawData: data || '',
                licenseNumber: data?.trim() || '',
                name: '',
                cnic: '',
                expiry: ''
            };
        }
    };

    // Helper function to parse date strings
    const parseDateString = (dateStr) => {
        if (!dateStr) return null;
        
        // Try different date formats
        const formats = [
            /^(\d{2})[-\/](\d{2})[-\/](\d{4})$/, // DD-MM-YYYY or DD/MM/YYYY
            /^(\d{4})[-\/](\d{2})[-\/](\d{2})$/, // YYYY-MM-DD or YYYY/MM/DD
            /^(\d{2})(\d{2})(\d{4})$/, // DDMMYYYY
        ];
        
        for (const format of formats) {
            const match = dateStr.match(format);
            if (match) {
                if (format === formats[0]) {
                    // DD-MM-YYYY
                    const day = parseInt(match[1], 10);
                    const month = parseInt(match[2], 10) - 1;
                    const year = parseInt(match[3], 10);
                    return new Date(year, month, day);
                } else if (format === formats[1]) {
                    // YYYY-MM-DD
                    const year = parseInt(match[1], 10);
                    const month = parseInt(match[2], 10) - 1;
                    const day = parseInt(match[3], 10);
                    return new Date(year, month, day);
                } else if (format === formats[2]) {
                    // DDMMYYYY
                    const day = parseInt(match[1], 10);
                    const month = parseInt(match[2], 10) - 1;
                    const year = parseInt(match[3], 10);
                    return new Date(year, month, day);
                }
            }
        }
        
        return null;
    };

    // -----------------------------
    // Barcode Scanner Functions
    // -----------------------------
    const startBarcodeScan = async () => {
        try {
            if (!permission) {
                const permissionResult = await requestPermission();
                if (!permissionResult.granted) {
                    Alert.alert("Camera Permission Required", "Please allow camera access to scan barcode.");
                    return;
                }
            } else if (!permission.granted) {
                const permissionResult = await requestPermission();
                if (!permissionResult.granted) {
                    Alert.alert("Camera Permission Required", "Please allow camera access to scan barcode.");
                    return;
                }
            }
            
            setShowScanner(true);
            setScanned(false);
            setIsScanning(true);
            setVerificationResult(null);
            setBarcodeData(null);
        } catch (error) {
            console.log("Start barcode scan error:", error);
            Alert.alert("Error", "Failed to start camera. Please try again.");
        }
    };

    const handleBarCodeScanned = ({ type, data }) => {
        console.log("Barcode scanned from camera:", data, "Type:", type);
        processBarcodeData(data);
    };

    // -----------------------------
    // Gallery Import Functions
    // -----------------------------
    const importBarcodeFromGallery = async () => {
        try {
            setImportingFromGallery(true);
            
            // Request gallery permissions
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert(
                    "Permission Required",
                    "Please allow access to photo library to import barcode images.",
                    [{ text: "OK" }]
                );
                return;
            }

            // Launch image picker
            let result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: false,
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                const imageUri = result.assets[0].uri;
                
                Alert.alert(
                    "Feature Note",
                    "Gallery barcode scanning requires additional setup. For now, please use camera scanning or manually enter your license information.\n\nIf you have a barcode image, please use the camera to scan it.",
                    [
                        {
                            text: "Use Camera Instead",
                            onPress: () => {
                                setShowImportOptions(false);
                                startBarcodeScan();
                            }
                        },
                        {
                            text: "Enter Manually",
                            onPress: () => {
                                setShowImportOptions(false);
                                // Allow manual entry even without scanning
                                setIsBarcodeScanned(true);
                            }
                        },
                        {
                            text: "Cancel",
                            style: "cancel"
                        }
                    ]
                );
            }
            
            setShowImportOptions(false);
        } catch (error) {
            console.log("Gallery import error:", error);
            Alert.alert("Error", "Failed to import image from gallery.");
        } finally {
            setImportingFromGallery(false);
        }
    };

    // -----------------------------
    // Verification Functions
    // -----------------------------
    const verifyLicense = () => {
        if (!barcodeData) {
            Alert.alert("No Barcode Data", "Please scan the license barcode first.");
            return;
        }
        
        if (!licenseNumber.trim()) {
            Alert.alert("Missing Information", "Please enter your license number.");
            return;
        }
        
        setVerificationResult('verifying');
        setVerificationDetails([]);
        
        // Prepare comparison details
        const details = [];
        let matchScore = 0;
        let totalChecks = 0;
        let requiresReview = false;
        
        // 1. License Number - MUST MATCH EXACTLY
        totalChecks++;
        if (barcodeData.licenseNumber && licenseNumber.trim().toUpperCase() === barcodeData.licenseNumber.toUpperCase()) {
            matchScore++;
            details.push({
                field: 'License Number',
                status: 'match',
                message: `✅ Exact match: ${licenseNumber}`
            });
        } else {
            details.push({
                field: 'License Number',
                status: 'mismatch',
                message: `❌ Mismatch: Entered "${licenseNumber}", Barcode "${barcodeData.licenseNumber || 'Not found'}"`
            });
            requiresReview = true;
        }
        
        setVerificationDetails(details);
        
        // Determine final verification result
        const matchPercentage = (matchScore / totalChecks) * 100;
        
        if (matchPercentage === 100) {
            setVerificationResult('verified');
            Alert.alert(
                "✅ License Verified",
                "License number matches barcode data!",
                [{ text: "Continue" }]
            );
        } else {
            setVerificationResult('failed');
            Alert.alert(
                "❌ Verification Failed",
                "License number doesn't match barcode data.",
                [{ text: "Try Again" }]
            );
        }
    };

    const removeSpacesAndValidate = (text, fieldName) => {
        if (!text) return '';
        
        if (fieldName === 'phone') return text.replace(/[^0-9]/g, '');
        if (fieldName === 'cnic') return text.replace(/[^0-9\-]/g, '');
        if (fieldName === 'licenseNumber') return text.replace(/[^0-9A-Za-z\-]/g, '').toUpperCase();
        if (fieldName === 'vehicleNumber') return text.replace(/[^A-Za-z0-9\-]/g, '');
        if (fieldName === 'name') return text.replace(/[^A-Za-z\s]/g, '');
        return text;
    };

    // -----------------------------
    // Validation Functions
    // -----------------------------
    const validateStep1 = () => {
        const cnicRegex = /^\d{5}-\d{7}-\d{1}$/;
        const nameRegex = /^[A-Za-z\s]+$/;
        const trimmedPhone = phone.replace(/\s/g, '');
        const trimmedCnic = cnic.replace(/\s/g, '');

        if (!name || !nameRegex.test(name)) return Alert.alert('Invalid Name', 'Enter a valid name');
        if (!trimmedPhone || !trimmedPhone.match(/^\d{11}$/)) return Alert.alert('Invalid Phone', 'Enter 11-digit phone');
        if (!trimmedCnic || !cnicRegex.test(trimmedCnic)) return Alert.alert('Invalid CNIC', 'Use 12345-1234567-1 format');
        if (!dob) return Alert.alert('Missing DOB', 'Select date of birth');
        if (!gender) return Alert.alert('Missing Gender', 'Select gender');
        if (!profileImage) return Alert.alert('Missing Image', 'Upload profile picture');
        return true;
    };

    const validateStep2 = () => {
        if (!vehicleType) return Alert.alert('Missing Vehicle Type', 'Select type');
        if (!vehicleBrand) return Alert.alert('Missing Vehicle Brand', 'Select brand');
        if (!vehicleNumber || !/^[A-Za-z0-9\-]+$/.test(vehicleNumber)) return Alert.alert('Invalid Vehicle Number', 'Enter valid number');
        return true;
    };

    const validateStep3 = async () => {
        // Allow manual entry even without barcode scan
        if (!isBarcodeScanned) {
            const proceedWithoutScan = await new Promise((resolve) => {
                Alert.alert(
                    "Barcode Not Scanned",
                    "You haven't scanned a barcode. Would you like to:\n1. Scan barcode now\n2. Continue with manual entry (verification will be manual)",
                    [
                        {
                            text: "Scan Now",
                            onPress: () => {
                                startBarcodeScan();
                                resolve(false);
                            }
                        },
                        {
                            text: "Continue Manually",
                            onPress: () => resolve(true)
                        },
                        {
                            text: "Cancel",
                            style: "cancel",
                            onPress: () => resolve(false)
                        }
                    ]
                );
            });
            
            if (!proceedWithoutScan) return false;
        }
        
        if (!licenseNumber.trim()) return Alert.alert('License Required', 'Enter license number');
        if (!expiryDate) return Alert.alert('Missing Expiry', 'Select expiry date');
        if (!issuingAuthority) return Alert.alert('Missing Authority', 'Select authority');
        
        // Add license photo validation
        if (!frontLicenseImage || !backLicenseImage) {
            Alert.alert(
                'License Photos Required',
                'Please capture both front and back photos of your driver\'s license',
                [
                    { 
                        text: 'Take Photos Now', 
                        onPress: () => captureLicensePhotos() 
                    },
                    { 
                        text: 'Cancel', 
                        style: 'cancel' 
                    }
                ]
            );
            return false;
        }
        
        // If barcode was scanned, verify it
        if (isBarcodeScanned && barcodeData) {
            if (verificationResult === null) {
                return Alert.alert('Verification Required', 'Please verify the license first');
            }
            
            if (verificationResult === 'failed') {
                Alert.alert(
                    'Verification Failed',
                    'License verification failed. Please check your license number and try again.',
                    [
                        { text: 'Re-scan Barcode', onPress: startBarcodeScan },
                        { text: 'Try Different Number', style: 'cancel' }
                    ]
                );
                return false;
            }
        }
        
        return true;
    };

    const validateStep4 = () => {
        if (!agreed) return Alert.alert('Agreement Required', 'You must accept the Privacy Policy and Terms & Conditions to continue');
        return true;
    };

    // -----------------------------
    // SIMPLIFIED: Save to Firestore - All images as local paths
    // -----------------------------
    const saveToFirestore = async () => {
        try {
            setIsUploading(true);
            setUploadProgress(0);
            
            const user = auth.currentUser;
            if (!user) {
                Alert.alert('Error', 'User not authenticated. Please log in again.');
                setIsUploading(false);
                return;
            }

            // No upload needed - just save local paths
            setUploadProgress(0.3);
            Alert.alert("Saving", "Saving your profile information...", [], { cancelable: false });
            
            console.log('Saving data to Firestore...');
            const userData = {
                name: name.trim(),
                profileImage, // Local file path
                phone: phone.trim(),
                gender,
                driverProfile: {
                    name: name.trim(),
                    phone: phone.trim(),
                    cnic,
                    dob: dob ? dob.toISOString() : null,
                    gender,
                    profileImage, // Local file path
                    vehicleType,
                    vehicleBrand,
                    vehicleNumber,
                    licenseNumber,
                    expiryDate: expiryDate ? expiryDate.toISOString() : null,
                    issuingAuthority,
                    licensePhotos: {
                        front: frontLicenseImage, // Local file path
                        back: backLicenseImage    // Local file path
                    },
                    licenseVerification: {
                        method: isBarcodeScanned ? 'barcode' : 'manual',
                        result: verificationResult,
                        details: verificationDetails,
                        barcodeScanned: isBarcodeScanned,
                        barcodeData: barcodeData,
                        verifiedAt: new Date().toISOString(),
                        manualReview: verificationResult === 'review' || !isBarcodeScanned,
                        photosCaptured: !!(frontLicenseImage && backLicenseImage),
                        photosUploaded: true // Since we're using local paths
                    }
                },
                setupCompleted: true,
                acceptedTerms: true,
                acceptedTermsDate: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            };

            console.log('User data to save (with local image paths):', JSON.stringify(userData, null, 2));
            
            try {
                await setDoc(
                    doc(db, 'users', user.uid),
                    userData,
                    { merge: true }
                );
                
                setUploadProgress(1.0);
                
                // Success
                setIsUploading(false);
                Alert.alert(
                    "✅ Setup Complete", 
                    "Your driver profile has been created successfully!",
                    [
                        { 
                            text: "Go to Dashboard", 
                            onPress: () => navigation.replace('DriverDashboard') 
                        }
                    ]
                );
                
            } catch (firestoreError) {
                console.error('Firestore save error:', firestoreError);
                setIsUploading(false);
                
                // Check Firestore permissions
                if (firestoreError.code === 'permission-denied') {
                    Alert.alert(
                        "Firestore Permission Error",
                        "Cannot save to database. Please:\n\n1. Check Firestore security rules\n2. Contact support",
                        [{ text: "OK" }]
                    );
                } else {
                    Alert.alert(
                        "Save Error",
                        `Failed to save profile: ${firestoreError.message}`,
                        [{ text: "OK" }]
                    );
                }
            }
            
        } catch (err) {
            console.error('Save to Firestore error:', err);
            setIsUploading(false);
            
            Alert.alert(
                "Setup Failed",
                `Failed to complete setup: ${err.message || 'Unknown error'}\n\nPlease try again or contact support.`,
                [{ text: "OK" }]
            );
        }
    };

    const handleNext = async () => {
        if (step === 1 && validateStep1()) setStep(2);
        else if (step === 2 && validateStep2()) setStep(3);
        else if (step === 3) {
            // Use await for the async validation
            const isValid = await validateStep3();
            if (isValid) setStep(4);
        }
        else if (step === 4 && validateStep4()) {
            // Show confirmation before final save
            Alert.alert(
                "Complete Setup",
                "Are you sure you want to submit your driver profile? Please verify:\n\n• All information is correct\n• License photos are clear\n• Terms & Conditions accepted",
                [
                    { text: "Review Again", style: "cancel" },
                    { text: "Yes, Submit", onPress: saveToFirestore }
                ]
            );
        }
    };

    const handleBack = () => setStep(step - 1);

    // -----------------------------
    // UI with Upload Progress
    // -----------------------------
    return (
        <View style={styles.container}>
            <View style={styles.headerWrapper}>
                <Text style={styles.title}>Drivemate</Text>
                <Text style={styles.subTitle}>Driver Setup</Text>
                <Text style={styles.smallText}>Provide your details</Text>
                
                {/* Progress Bar */}
                {isUploading && (
                    <View style={styles.uploadProgressContainer}>
                        <View style={styles.progressBarBackground}>
                            <View 
                                style={[
                                    styles.progressBarFill, 
                                    { width: `${uploadProgress * 100}%` }
                                ]} 
                            />
                        </View>
                        <Text style={styles.progressText}>
                            {uploadProgress < 0.5 ? 'Saving profile...' : 
                             'Finishing up...'}
                        </Text>
                    </View>
                )}
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardAvoidingView}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
            >
                <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
                    
                    {/* STEP 1 */}
                    {step === 1 && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.toptext}>Personal Details</Text>
                            <Text style={styles.label}>Full Name</Text>
                            <TextInput
                                style={styles.input}
                                value={name}
                                onChangeText={(text) => setName(removeSpacesAndValidate(text, 'name'))}
                                placeholder="Enter full name"
                                placeholderTextColor="#000"
                            />
                            <Text style={styles.label}>Profile Picture</Text>
                            <TouchableOpacity style={styles.imageUploadBox} onPress={pickProfileImage}>
                                {profileImage ? <Image source={{ uri: profileImage }} style={styles.imagePreview} /> :
                                    <Text style={styles.uploadText}>Upload Profile Picture</Text>}
                            </TouchableOpacity>
                            <Text style={styles.label}>Phone Number</Text>
                            <TextInput
                                style={styles.input}
                                value={phone}
                                onChangeText={(text) => setPhone(removeSpacesAndValidate(text, 'phone'))}
                                keyboardType="number-pad"
                                placeholder="e.g. 030XXXXXXXX"
                                placeholderTextColor="#000"
                                maxLength={11}
                            />
                            <Text style={styles.label}>CNIC</Text>
                            <TextInput
                                style={styles.input}
                                value={cnic}
                                onChangeText={(text) => setCnic(removeSpacesAndValidate(text, 'cnic'))}
                                placeholder="XXXXX-XXXXXXX-X"
                                placeholderTextColor="#000"
                                maxLength={15}
                            />
                            <Text style={styles.label}>Date of Birth</Text>
                            <TouchableOpacity style={styles.input} onPress={() => setShowDobPicker(true)}>
                                <Text style={{ color: dob ? 'black' : '#888' }}>{dob ? formatDate(dob) : 'Select date'}</Text>
                            </TouchableOpacity>
                            {showDobPicker && (
                                <DateTimePicker
                                    value={dob || new Date()}
                                    mode="date"
                                    display="default"
                                    maximumDate={new Date()}
                                    onChange={(event, selectedDate) => {
                                        setShowDobPicker(false);
                                        if (selectedDate) setDob(selectedDate);
                                    }}
                                />
                            )}
                            <Text style={styles.label}>Gender</Text>
                            <RNPickerSelect
                                onValueChange={setGender}
                                value={gender}
                                placeholder={{ label: 'Select Gender', value: '' }}
                                placeholderTextColor="#000"
                                items={[
                                    { label: 'Male', value: 'Male' },
                                    { label: 'Female', value: 'Female' },
                                    { label: 'Custom', value: 'Custom' },
                                ]}
                                style={pickerStyle}
                            />
                        </View>
                    )}

                    {/* STEP 2 */}
                    {step === 2 && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.toptext}>Vehicle Details</Text>
                            <Text style={styles.label}>Vehicle Type</Text>
                            <RNPickerSelect
                                onValueChange={setVehicleType}
                                value={vehicleType}
                                placeholder={{ label: 'Select type', value: '' }}
                                placeholderTextColor="#000"
                                
                                items={[{ label: 'Car', value: 'Car' }, { label: 'Bike', value: 'Bike' }]}
                                style={pickerStyle}
                            />
                            <Text style={styles.label}>Vehicle Brand</Text>
                            <RNPickerSelect
                                onValueChange={setVehicleBrand}
                                value={vehicleBrand}
                                placeholder={{ label: 'Select brand', value: '' }}
                                placeholderTextColor="#000"
                                items={[
                                    { label: 'Honda', value: 'Honda' },
                                    { label: 'Suzuki', value: 'Suzuki' },
                                    { label: 'Toyota', value: 'Toyota' },
                                    { label: 'KIA', value: 'KIA' },
                                ]}
                                style={pickerStyle}
                            />
                            <Text style={styles.label}>Vehicle Number</Text>
                            <TextInput
                                style={styles.input}
                                value={vehicleNumber}
                                onChangeText={(text) => setVehicleNumber(removeSpacesAndValidate(text, 'vehicleNumber'))}
                                placeholder="e.g. LHR-1234"
                                placeholderTextColor="#000"
                            />
                        </View>
                    )}

                    {/* STEP 3 - Barcode-based License Verification */}
                    {step === 3 && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.toptext}>License Verification</Text>
                            
                            {/* Barcode Scanning Section */}
                            <Text style={styles.label}>Step 1: Scan License Barcode/QR Code *</Text>
                            <Text style={styles.hintText}>
                                Scan the barcode or QR code on the back of your driver's license (Recommended)
                            </Text>
                            
                            {/* Scan/Import Options */}
                            <View style={styles.scanOptionsContainer}>
                                <TouchableOpacity
                                    style={[
                                        styles.scanOptionButton,
                                        isBarcodeScanned && styles.verifiedBorder
                                    ]}
                                    onPress={startBarcodeScan}
                                    disabled={isScanning}
                                >
                                    {isScanning ? (
                                        <View style={styles.scanningContainer}>
                                            <ActivityIndicator size="large" color="#1d807c" />
                                            <Text style={styles.scanningText}>Scanning...</Text>
                                        </View>
                                    ) : (
                                        <View style={styles.scanOptionContent}>
                                            <Ionicons name="camera" size={30} color="#1d807c" />
                                            <Text style={styles.scanOptionTitle}>
                                                {isBarcodeScanned ? ' Barcode Scanned' : 'Use Camera'}
                                            </Text>
                                            <Text style={styles.scanOptionSubtitle}>
                                                Scan with camera
                                            </Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                                
                                <TouchableOpacity
                                    style={[
                                        styles.scanOptionButton,
                                        isBarcodeScanned && styles.verifiedBorder
                                    ]}
                                    onPress={() => setShowImportOptions(true)}
                                    disabled={importingFromGallery || isScanning}
                                >
                                    {importingFromGallery ? (
                                        <View style={styles.scanningContainer}>
                                            <ActivityIndicator size="large" color="#1d807c" />
                                            <Text style={styles.scanningText}>Importing...</Text>
                                        </View>
                                    ) : (
                                        <View style={styles.scanOptionContent}>
                                            <Ionicons name="images" size={30} color="#1d807c" />
                                            <Text style={styles.scanOptionTitle}>
                                                {isBarcodeScanned ? ' Barcode Imported' : 'Import from Gallery'}
                                            </Text>
                                            <Text style={styles.scanOptionSubtitle}>
                                                Choose existing image
                                            </Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            </View>
                            
                            {/* Manual Entry Section */}
                            <Text style={styles.label}>Step 2: Enter License Information *</Text>
                            <Text style={styles.hintText}>
                                Enter your license information exactly as shown on your license card
                            </Text>
                            
                            <Text style={styles.subLabel}>License Number *</Text>
                            <TextInput
                                style={styles.input}
                                value={licenseNumber}
                                onChangeText={(text) => setLicenseNumber(removeSpacesAndValidate(text, 'licenseNumber'))}
                                placeholder="e.g., JM-20-477"
                                placeholderTextColor="#000"
                                editable={true}
                            />
                            
                            <Text style={styles.subLabel}>Expiry Date *</Text>
                            <TouchableOpacity 
                                style={styles.input} 
                                onPress={() => setShowExpiryPicker(true)}
                            >
                                <Text style={{ color: expiryDate ? 'black' : '#888' }}>
                                    {expiryDate ? formatDate(expiryDate) : 'Select expiry date'}
                                </Text>
                            </TouchableOpacity>
                            {showExpiryPicker && (
                                <DateTimePicker
                                    value={expiryDate || new Date()}
                                    mode="date"
                                    display="default"
                                    minimumDate={new Date()}
                                    onChange={(event, selectedDate) => {
                                        setShowExpiryPicker(false);
                                        if (selectedDate) setExpiryDate(selectedDate);
                                    }}
                                />
                            )}
                            
                            <Text style={styles.subLabel}>Issuing Authority *</Text>
                            <RNPickerSelect
                                onValueChange={setIssuingAuthority}
                                value={issuingAuthority}
                                placeholder={{ label: 'Select authority', value: '' }}
                                placeholderTextColor="#000"
                                items={[
                                    { label: 'Excise & Taxation', value: 'Excise & Taxation' },
                                    { label: 'Traffic Police', value: 'Traffic Police' },
                                    { label: 'Other', value: 'Other' },
                                ]}
                                style={pickerStyle}
                            />
                            {/* Verification Section - Only show if barcode was scanned */}
                            {isBarcodeScanned && barcodeData && (
                                <>
                                    <Text style={styles.label}>Step 3: Verify Information</Text>
                                    
                                    <TouchableOpacity
                                        style={[
                                            styles.verifyButton,
                                            verificationResult === 'verified' && styles.verifiedButton,
                                            verificationResult === 'failed' && styles.failedButton
                                        ]}
                                        onPress={verifyLicense}
                                        disabled={!licenseNumber}
                                    >
                                        <Text style={styles.verifyButtonText}>
                                            {verificationResult === 'verified' ? ' Verified' :
                                             verificationResult === 'failed' ? ' Failed' :
                                             'Verify License'}
                                        </Text>
                                    </TouchableOpacity>
                                    
                                    {/* Barcode Data Preview (for debugging) */}
                                    {__DEV__ && barcodeData && (
                                        <View style={styles.debugInfo}>
                                            <Text style={styles.debugTitle}>Debug Info (Barcode Data):</Text>
                                            <Text style={styles.debugText}>License: {barcodeData.licenseNumber || 'Not found'}</Text>
                                            <Text style={styles.debugText}>Name: {barcodeData.name || 'Not found'}</Text>
                                            <Text style={styles.debugText}>CNIC: {barcodeData.cnic || 'Not found'}</Text>
                                        </View>
                                    )}
                                </>
                            )}
                            
                            {/* Step 4: Capture License Photos */}
                            <Text style={styles.label}>Step 4: Capture License Photos *</Text>
                            <Text style={styles.hintText}>
                                Take clear photos of both sides of your driver's license card
                            </Text>

                            <View style={styles.licensePhotoContainer}>
                                {/* Front License Photo */}
                                <View style={styles.licensePhotoBox}>
                                    <Text style={styles.licensePhotoLabel}>Front Side</Text>
                                    <TouchableOpacity
                                        style={styles.licensePhotoButton}
                                        onPress={() => captureSinglePhoto('front')}
                                        disabled={isTakingLicensePhotos}
                                    >
                                        {frontLicenseImage ? (
                                            <View style={styles.photoPreviewContainer}>
                                                <Image source={{ uri: frontLicenseImage }} style={styles.licensePhotoPreview} />
                                                <View style={styles.photoCheckmark}>
                                                    <Ionicons name="checkmark-circle" size={24} color="green" />
                                                </View>
                                            </View>
                                        ) : (
                                            <View style={styles.photoPlaceholder}>
                                                <Ionicons name="camera" size={30} color="#1d807c" />
                                                <Text style={styles.photoPlaceholderText}>Front Photo</Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                </View>

                                {/* Back License Photo */}
                                <View style={styles.licensePhotoBox}>
                                    <Text style={styles.licensePhotoLabel}>Back Side</Text>
                                    <TouchableOpacity
                                        style={styles.licensePhotoButton}
                                        onPress={() => captureSinglePhoto('back')}
                                        disabled={isTakingLicensePhotos}
                                    >
                                        {backLicenseImage ? (
                                            <View style={styles.photoPreviewContainer}>
                                                <Image source={{ uri: backLicenseImage }} style={styles.licensePhotoPreview} />
                                                <View style={styles.photoCheckmark}>
                                                    <Ionicons name="checkmark-circle" size={24} color="green" />
                                                </View>
                                            </View>
                                        ) : (
                                            <View style={styles.photoPlaceholder}>
                                                <Ionicons name="camera" size={30} color="#1d807c" />
                                                <Text style={styles.photoPlaceholderText}>Back Photo</Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {licensePhotosUploaded && (
                                <View style={styles.photosUploadedMessage}>
                                    <Ionicons name="checkmark-done-circle" size={20} color="green" />
                                    <Text style={styles.photosUploadedText}>
                                        License photos captured and ready for upload
                                    </Text>
                                </View>
                            )}
                            
                            {/* Verification Details */}
                            {verificationDetails.length > 0 && (
                                <View style={styles.verificationDetails}>
                                    <Text style={styles.verificationTitle}>Verification Results:</Text>
                                    {verificationDetails.map((detail, index) => (
                                        <View key={index} style={styles.detailRow}>
                                            <Ionicons
                                                name={
                                                    detail.status === 'match' ? "checkmark-circle" :
                                                    "close-circle"
                                                }
                                                size={16}
                                                color={
                                                    detail.status === 'match' ? "green" : "red"
                                                }
                                            />
                                            <Text style={[
                                                styles.detailText,
                                                detail.status === 'match' && styles.matchText,
                                                detail.status === 'mismatch' && styles.mismatchText
                                            ]}>
                                                {detail.message}
                                            </Text>
                                        </View>
                                    ))}
                                    
                                    {verificationResult === 'verified' && (
                                        <View style={styles.successMessage}>
                                            <Ionicons name="shield-checkmark" size={24} color="green" />
                                            <Text style={styles.successText}>License Verified Successfully!</Text>
                                        </View>
                                    )}
                                    
                                    {verificationResult === 'failed' && (
                                        <View style={styles.failedMessage}>
                                            <Ionicons name="alert-circle" size={24} color="red" />
                                            <Text style={styles.failedText}>
                                                License number doesn't match. Please check and try again.
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            )}
                            
                            {/* Instructions */}
                            <View style={styles.instructionsBox}>
                                <Ionicons name="information-circle" size={20} color="#1d807c" />
                                <Text style={styles.instructionsText}>
                                    {isBarcodeScanned 
                                        ? " Barcode scanned successfully. Enter your license number and verify."
                                        : " Scan barcode for automatic verification, or enter manually."
                                    }
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* STEP 4 - Terms & Conditions */}
                    {step === 4 && (
                        <View style={styles.inputGroup}>
                            <Text style={styles.toptext}>Terms & Conditions</Text>
                            <Text style={styles.label}>Agreements</Text>
                            
                            <View style={styles.agreementContainer}>
                                <View style={styles.agreementTextContainer}>
                                    <Text style={styles.agreementText}>
                                        By proceeding, you agree to our Privacy Policy and Terms & Conditions. Please read them carefully before accepting.
                                    </Text>
                                </View>
                                
                                <TouchableOpacity
                                    style={styles.checkboxContainer}
                                    onPress={() => setAgreed(!agreed)}
                                >
                                    <View style={styles.checkbox}>
                                        {agreed && <View style={styles.checkboxTick} />}
                                    </View>
                                    <Text style={styles.checkboxLabel}>
                                        I have read and agree to the 
                                        <Text style={styles.linkText} onPress={() => setShowPrivacy(true)}> Privacy Policy</Text> and 
                                        <Text style={styles.linkText} onPress={() => setShowTerms(true)}> Terms & Conditions</Text>
                                    </Text>
                                </TouchableOpacity>
                                
                                <View style={styles.agreementDetails}>
                                    <Text style={styles.agreementDetailText}>
                                        • Your data will be stored securely and used only for verification purposes
                                    </Text>
                                    <Text style={styles.agreementDetailText}>
                                        • You must provide accurate and truthful information
                                    </Text>
                                    <Text style={styles.agreementDetailText}>
                                        • You agree to follow all platform rules and regulations
                                    </Text>
                                    <Text style={styles.agreementDetailText}>
                                        • Violation of terms may result in account suspension
                                    </Text>
                                </View>
                            </View>
                        </View>
                    )}

                    {/* Navigation Buttons */}
                    <View style={styles.navButtons}>
                        {step > 1 && (
                            <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
                                <Text style={styles.btnText}>Back</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity 
                            style={[styles.nextBtn, isUploading && styles.disabledBtn]} 
                            onPress={handleNext}
                            disabled={isUploading}
                        >
                            {isUploading ? (
                                <ActivityIndicator color="white" />
                            ) : (
                                <Text style={styles.btnText}>{step === 4 ? 'Complete Setup' : 'Next'}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Barcode Scanner Modal */}
            <Modal
                visible={showScanner}
                animationType="slide"
                transparent={false}
                onRequestClose={() => {
                    setShowScanner(false);
                    setIsScanning(false);
                }}
            >
                <View style={styles.scannerContainer}>
                    <View style={styles.scannerHeader}>
                        <TouchableOpacity 
                            style={styles.closeScannerButton}
                            onPress={() => {
                                setShowScanner(false);
                                setIsScanning(false);
                            }}
                        >
                            <Ionicons name="close" size={30} color="white" />
                        </TouchableOpacity>
                        <Text style={styles.scannerTitle}>Scan License Barcode</Text>
                    </View>
                    
                    {permission && permission.granted ? (
                        <>
                            {!scanned && (
                                <CameraView
                                    ref={cameraRef}
                                    style={StyleSheet.absoluteFillObject}
                                    facing="back"
                                    barcodeScannerSettings={{
                                        barcodeTypes: [
                                            'qr',
                                            'pdf417',
                                            'aztec',
                                            'code39',
                                            'code93',
                                            'code128',
                                            'ean13',
                                            'ean8',
                                            'upc_a',
                                            'upc_e',
                                            'datamatrix',
                                            'itf14'
                                        ],
                                    }}
                                    onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                                />
                            )}
                            
                            <View style={styles.scannerOverlay}>
                                <View style={styles.scannerFrame}>
                                    <View style={styles.cornerTL} />
                                    <View style={styles.cornerTR} />
                                    <View style={styles.cornerBL} />
                                    <View style={styles.cornerBR} />
                                </View>
                                <Text style={styles.scannerInstructions}>
                                    Align the barcode within the frame
                                </Text>
                            </View>
                            
                            {scanned && (
                                <TouchableOpacity
                                    style={styles.rescanButton}
                                    onPress={() => {
                                        setScanned(false);
                                        setIsScanning(true);
                                    }}
                                >
                                    <Text style={styles.rescanText}>Tap to Scan Again</Text>
                                </TouchableOpacity>
                            )}
                        </>
                    ) : (
                        <View style={styles.permissionContainer}>
                            <Ionicons name="camera-off" size={60} color="#ff6b6b" />
                            <Text style={styles.permissionText}>Camera permission required</Text>
                            <TouchableOpacity
                                style={styles.permissionButton}
                                onPress={requestPermission}
                            >
                                <Text style={styles.permissionButtonText}>Grant Permission</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </Modal>

            {/* Import Options Modal */}
            <Modal
                visible={showImportOptions}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowImportOptions(false)}
            >
                <View style={styles.importModalContainer}>
                    <View style={styles.importModalContent}>
                        <Text style={styles.importModalTitle}>Import Barcode</Text>
                        <Text style={styles.importModalText}>
                            Choose an option to import barcode/QR code:
                        </Text>
                        
                        <TouchableOpacity
                            style={styles.importOptionButton}
                            onPress={importBarcodeFromGallery}
                        >
                            <Ionicons name="images" size={24} color="#1d807c" />
                            <View style={styles.importOptionTextContainer}>
                                <Text style={styles.importOptionTitle}>Photo Gallery</Text>
                                <Text style={styles.importOptionDescription}>
                                    Select an image containing barcode/QR code
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#666" />
                        </TouchableOpacity>
                        
                        <TouchableOpacity
                            style={styles.importOptionButton}
                            onPress={() => {
                                setShowImportOptions(false);
                                startBarcodeScan();
                            }}
                        >
                            <Ionicons name="camera" size={24} color="#1d807c" />
                            <View style={styles.importOptionTextContainer}>
                                <Text style={styles.importOptionTitle}>Use Camera Instead</Text>
                                <Text style={styles.importOptionDescription}>
                                    Scan barcode using camera
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color="#666" />
                        </TouchableOpacity>
                        
                        <TouchableOpacity
                            style={styles.importCancelButton}
                            onPress={() => setShowImportOptions(false)}
                        >
                            <Text style={styles.importCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Privacy Policy Modal */}
            <Modal visible={showPrivacy} animationType="slide">
                <View style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Privacy Policy</Text>
                        <TouchableOpacity onPress={() => setShowPrivacy(false)} style={styles.modalCloseButton}>
                            <Ionicons name="close" size={24} color="#333" />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalContent}>
                        <Text style={styles.modalSectionTitle}>1. Information We Collect</Text>
                        <Text style={styles.modalText}>
                            • Personal Information: Name, phone number, CNIC, date of birth, gender{'\n'}
                            • License Information: Driver's license number, expiry date, issuing authority{'\n'}
                            • Vehicle Information: Vehicle type, brand, and registration number{'\n'}
                            • Profile Picture: Your profile photograph{'\n'}
                            • License Photos: Front and back photos of your driver's license card{'\n'}
                            • Barcode Data: Information extracted from your license barcode
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>2. How We Use Your Information</Text>
                        <Text style={styles.modalText}>
                            • To verify your identity and driver's license authenticity{'\n'}
                            • To create and maintain your driver profile{'\n'}
                            • To ensure platform safety and security{'\n'}
                            • To comply with legal requirements{'\n'}
                            • To provide customer support
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>3. Data Security</Text>
                        <Text style={styles.modalText}>
                            We implement industry-standard security measures to protect your personal information. Your data is encrypted and stored securely on Firebase servers. License photos are stored securely and accessed only for verification purposes.
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>4. Data Retention</Text>
                        <Text style={styles.modalText}>
                            We retain your information as long as your account is active or as needed to provide services. You can request account deletion at any time, which will include deletion of all stored photos.
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>5. Your Rights</Text>
                        <Text style={styles.modalText}>
                            • Access your personal data{'\n'}
                            • Correct inaccurate data{'\n'}
                            • Request data deletion{'\n'}
                            • Opt-out of communications{'\n'}
                            • File complaints with regulatory authorities
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>6. Contact Us</Text>
                        <Text style={styles.modalText}>
                            For privacy-related questions, contact us at: privacy@drivemate.com
                        </Text>
                    </ScrollView>
                </View>
            </Modal>

            {/* Terms & Conditions Modal */}
            <Modal visible={showTerms} animationType="slide">
                <View style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Terms & Conditions</Text>
                        <TouchableOpacity onPress={() => setShowTerms(false)} style={styles.modalCloseButton}>
                            <Ionicons name="close" size={24} color="#333" />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.modalContent}>
                        <Text style={styles.modalSectionTitle}>1. Acceptance of Terms</Text>
                        <Text style={styles.modalText}>
                            By using Drivemate, you agree to these Terms & Conditions. If you disagree, please do not use our services.
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>2. Driver Requirements</Text>
                        <Text style={styles.modalText}>
                            • Must have a valid driver's license{'\n'}
                            • Must be at least 18 years old{'\n'}
                            • Must provide accurate and truthful information{'\n'}
                            • Must have valid vehicle registration and insurance{'\n'}
                            • Must maintain a safe driving record{'\n'}
                            • Must provide clear photos of both sides of driver's license
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>3. License Verification</Text>
                        <Text style={styles.modalText}>
                            • You authorize us to verify your driver's license using barcode scanning{'\n'}
                            • You must provide clear photos of front and back of your license{'\n'}
                            • You must provide a valid, unexpired driver's license{'\n'}
                            • Providing false information is prohibited and may result in legal action{'\n'}
                            • License verification is mandatory for all drivers
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>4. User Responsibilities</Text>
                        <Text style={styles.modalText}>
                            • Follow all traffic laws and regulations{'\n'}
                            • Maintain vehicle in safe operating condition{'\n'}
                            • Provide respectful service to all passengers{'\n'}
                            • Report any incidents or accidents immediately{'\n'}
                            • Keep your profile information up-to-date
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>5. Prohibited Activities</Text>
                        <Text style={styles.modalText}>
                            • Driving under the influence of alcohol or drugs{'\n'}
                            • Using someone else's account or license{'\n'}
                            • Harassing or discriminating against passengers{'\n'}
                            • Violating passenger privacy{'\n'}
                            • Engaging in illegal activities using the platform
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>6. Platform Rules</Text>
                        <Text style={styles.modalText}>
                            • We reserve the right to suspend or terminate accounts{'\n'}
                            • Fees and rates are subject to change{'\n'}
                            • You are responsible for your tax obligations{'\n'}
                            • We are not liable for accidents or incidents{'\n'}
                            • Disputes should be reported within 24 hours
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>7. Changes to Terms</Text>
                        <Text style={styles.modalText}>
                            We may update these terms periodically. Continued use of the platform constitutes acceptance of updated terms.
                        </Text>
                        
                        <Text style={styles.modalSectionTitle}>8. Contact Information</Text>
                        <Text style={styles.modalText}>
                            For questions about these terms, contact: legal@drivemate.com
                        </Text>
                    </ScrollView>
                </View>
            </Modal>

            <Footer />
        </View>
    );
};

const { width } = Dimensions.get('window');
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    headerWrapper: { padding: 20, backgroundColor: '#1d807c' },
    title: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
    subTitle: { fontSize: 18, color: '#fff', marginTop: 5 },
    smallText: { fontSize: 14, color: '#fff', marginTop: 3 },
    // Upload Progress Styles
    uploadProgressContainer: {
        marginTop: 15,
        paddingHorizontal: 5,
    },
    progressBarBackground: {
        height: 8,
        backgroundColor: 'rgba(255,255,255,0.3)',
        borderRadius: 4,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: '#4CAF50',
        borderRadius: 4,
    },
    progressText: {
        color: '#fff',
        fontSize: 12,
        marginTop: 5,
        textAlign: 'center',
    },
    keyboardAvoidingView: { flex: 1 },
    formContainer: { padding: 20, paddingBottom: 50 },
    inputGroup: { marginBottom: 30 },
    toptext: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
    label: { fontSize: 16, marginBottom: 5, marginTop: 10 },
    subLabel: { fontSize: 14, fontWeight: '500', marginBottom: 5, marginTop: 10 },
    hintText: {
        fontSize: 14,
        color: '#666',
        marginBottom: 10,
        fontStyle: 'italic',
    },
    input: {
        borderWidth: 2,
        borderColor: '#ccc',
        borderRadius: 10,
        padding: 10,
        fontSize: 16,
        backgroundColor: '#f9f9f9',
    },
    scanOptionsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginVertical: 10,
        gap: 10,
    },
    scanOptionButton: {
        flex: 1,
        borderWidth: 2,
        borderColor: '#1d807c',
        borderRadius: 10,
        padding: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f0f9f9',
        minHeight: 120,
    },
    verifiedBorder: {
        borderColor: 'green',
        backgroundColor: '#f0f9f0',
    },
    scanningContainer: {
        alignItems: 'center',
        padding: 10,
    },
    scanningText: {
        color: '#1d807c',
        fontSize: 14,
        marginTop: 10,
        textAlign: 'center',
    },
    scanOptionContent: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    scanOptionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1d807c',
        marginTop: 10,
        textAlign: 'center',
    },
    scanOptionSubtitle: {
        fontSize: 12,
        color: '#666',
        marginTop: 5,
        textAlign: 'center',
    },
    verifyButton: {
        backgroundColor: '#1d807c',
        padding: 15,
        borderRadius: 10,
        alignItems: 'center',
        marginVertical: 20,
    },
    verifiedButton: {
        backgroundColor: 'green',
    },
    failedButton: {
        backgroundColor: 'red',
    },
    verifyButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    verificationDetails: {
        backgroundColor: '#f8f8f8',
        padding: 15,
        borderRadius: 10,
        marginVertical: 10,
    },
    verificationTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 10,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 5,
    },
    detailText: {
        fontSize: 14,
        marginLeft: 10,
        flex: 1,
    },
    matchText: {
        color: 'green',
    },
    mismatchText: {
        color: 'red',
    },
    successMessage: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#e8f7e8',
        padding: 15,
        borderRadius: 10,
        marginTop: 15,
    },
    successText: {
        fontSize: 16,
        color: 'green',
        fontWeight: '600',
        marginLeft: 10,
    },
    failedMessage: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffe8e8',
        padding: 15,
        borderRadius: 10,
        marginTop: 15,
    },
    failedText: {
        fontSize: 14,
        color: 'red',
        marginLeft: 10,
        flex: 1,
    },
    instructionsBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f0f9f9',
        padding: 12,
        borderRadius: 8,
        marginTop: 10,
        borderLeftWidth: 4,
        borderLeftColor: '#1d807c',
    },
    instructionsText: {
        fontSize: 14,
        color: '#555',
        marginLeft: 10,
        flex: 1,
    },
    // Debug info styles
    debugInfo: {
        backgroundColor: '#f0f0f0',
        padding: 10,
        borderRadius: 5,
        marginVertical: 10,
        borderLeftWidth: 3,
        borderLeftColor: '#666',
    },
    debugTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#666',
        marginBottom: 5,
    },
    debugText: {
        fontSize: 12,
        color: '#333',
        marginBottom: 2,
    },
    // License Photo Styles
    licensePhotoContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginVertical: 10,
    },
    licensePhotoBox: {
        width: '48%',
    },
    licensePhotoLabel: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 8,
        color: '#333',
        textAlign: 'center',
    },
    licensePhotoButton: {
        height: 150,
        borderWidth: 2,
        borderColor: '#ccc',
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: '#f9f9f9',
    },
    licensePhotoPreview: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    photoPlaceholder: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    photoPlaceholderText: {
        marginTop: 8,
        color: '#666',
        fontSize: 14,
    },
    photoPreviewContainer: {
        position: 'relative',
        width: '100%',
        height: '100%',
    },
    photoCheckmark: {
        position: 'absolute',
        top: 5,
        right: 5,
        backgroundColor: 'white',
        borderRadius: 12,
    },
    photosUploadedMessage: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#e8f7e8',
        padding: 12,
        borderRadius: 8,
        marginTop: 10,
    },
    photosUploadedText: {
        marginLeft: 10,
        color: 'green',
        fontSize: 14,
        fontWeight: '500',
    },
    // Import Modal Styles
    importModalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    importModalContent: {
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        paddingBottom: 30,
    },
    importModalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 10,
        textAlign: 'center',
    },
    importModalText: {
        fontSize: 16,
        color: '#666',
        marginBottom: 20,
        textAlign: 'center',
    },
    importOptionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        backgroundColor: '#f8f8f8',
        borderRadius: 10,
        marginBottom: 10,
    },
    importOptionTextContainer: {
        flex: 1,
        marginLeft: 15,
    },
    importOptionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    importOptionDescription: {
        fontSize: 14,
        color: '#666',
        marginTop: 2,
    },
    importCancelButton: {
        marginTop: 10,
        padding: 15,
        backgroundColor: '#ff6b6b',
        borderRadius: 10,
        alignItems: 'center',
    },
    importCancelText: {
        fontSize: 16,
        fontWeight: '600',
        color: 'white',
    },
    // Terms & Conditions Styles
    agreementContainer: {
        backgroundColor: '#f8f8f8',
        padding: 20,
        borderRadius: 10,
        marginTop: 10,
    },
    agreementTextContainer: {
        marginBottom: 20,
        paddingBottom: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#ddd',
    },
    agreementText: {
        fontSize: 16,
        color: '#333',
        lineHeight: 22,
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        padding: 10,
        backgroundColor: '#fff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ddd',
    },
    checkbox: {
        width: 24,
        height: 24,
        borderWidth: 2,
        borderColor: '#1d807c',
        borderRadius: 4,
        marginRight: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxTick: {
        width: 14,
        height: 14,
        backgroundColor: '#1d807c',
        borderRadius: 2,
    },
    checkboxLabel: {
        fontSize: 16,
        color: '#333',
        flex: 1,
        lineHeight: 22,
    },
    linkText: {
        color: '#1d807c',
        fontWeight: '600',
    },
    agreementDetails: {
        backgroundColor: '#fff',
        padding: 15,
        borderRadius: 8,
        borderLeftWidth: 4,
        borderLeftColor: '#1d807c',
    },
    agreementDetailText: {
        fontSize: 14,
        color: '#555',
        marginBottom: 8,
        lineHeight: 20,
    },
    // Modal Styles
    modalContainer: {
        flex: 1,
        backgroundColor: '#fff',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        paddingTop: 50,
        backgroundColor: '#f8f8f8',
        borderBottomWidth: 1,
        borderBottomColor: '#ddd',
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1d807c',
    },
    modalCloseButton: {
        padding: 5,
    },
    modalContent: {
        padding: 20,
    },
    modalSectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
        marginTop: 20,
        marginBottom: 10,
    },
    modalText: {
        fontSize: 16,
        color: '#555',
        lineHeight: 24,
        marginBottom: 15,
    },
    // Scanner Styles
    scannerContainer: {
        flex: 1,
        backgroundColor: 'black',
    },
    scannerHeader: {
        paddingTop: 50,
        paddingHorizontal: 20,
        paddingBottom: 20,
        backgroundColor: 'rgba(0,0,0,0.7)',
        flexDirection: 'row',
        alignItems: 'center',
    },
    closeScannerButton: {
        marginRight: 15,
    },
    scannerTitle: {
        color: 'white',
        fontSize: 20,
        fontWeight: 'bold',
        flex: 1,
    },
    scannerOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scannerFrame: {
        width: 250,
        height: 150,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    cornerTL: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: 30,
        height: 30,
        borderTopWidth: 4,
        borderLeftWidth: 4,
        borderColor: '#1d807c',
    },
    cornerTR: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 30,
        height: 30,
        borderTopWidth: 4,
        borderRightWidth: 4,
        borderColor: '#1d807c',
    },
    cornerBL: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: 30,
        height: 30,
        borderBottomWidth: 4,
        borderLeftWidth: 4,
        borderColor: '#1d807c',
    },
    cornerBR: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 30,
        height: 30,
        borderBottomWidth: 4,
        borderRightWidth: 4,
        borderColor: '#1d807c',
    },
    scannerInstructions: {
        color: 'white',
        fontSize: 16,
        marginTop: 180,
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: 10,
        borderRadius: 5,
    },
    rescanButton: {
        position: 'absolute',
        bottom: 40,
        alignSelf: 'center',
        backgroundColor: '#1d807c',
        padding: 15,
        borderRadius: 30,
    },
    rescanText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    permissionContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'black',
    },
    permissionText: {
        color: 'white',
        fontSize: 18,
        marginTop: 20,
        textAlign: 'center',
    },
    permissionButton: {
        marginTop: 20,
        backgroundColor: '#1d807c',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
    },
    permissionButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    imageUploadBox: {
        width: width - 40,
        height: 150,
        borderWidth: 2,
        borderColor: '#ccc',
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 5,
        backgroundColor: '#f9f9f9',
    },
    imagePreview: {
        width: width - 44,
        height: 146,
        borderRadius: 8,
        resizeMode: 'cover',
    },
    uploadText: {
        color: '#888',
        fontSize: 16,
    },
    navButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 20,
    },
    backBtn: {
        backgroundColor: '#ccc',
        padding: 15,
        borderRadius: 10,
        flex: 0.45,
        alignItems: 'center',
    },
    nextBtn: {
        backgroundColor: '#1d807c',
        padding: 15,
        borderRadius: 10,
        flex: 0.45,
        alignItems: 'center',
    },
    disabledBtn: {
        backgroundColor: '#ccc',
    },
    btnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
});

export default DriverSetup1;